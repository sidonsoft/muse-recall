import type { MediaAssetSummaryView, MediaJob, MediaVersionRecordView } from '@mml/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';
import { Icon } from '../Icon.tsx';
import { ReferencePanel } from './ReferencePanel.tsx';

const SIZES = ['512x512', '1024x1024', '1024x1536', '1536x1024'] as const;
const MIME_BY_TYPE: Record<string, string> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function readBase64(file: File): Promise<{ mime: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const mime = MIME_BY_TYPE[file.type];
    if (!mime) {
      reject(new Error('Only PNG, JPEG and WebP images are accepted.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('The image could not be read.'));
        return;
      }
      resolve({ mime, dataBase64: result.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}

function isActive(job: MediaJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/**
 * Media asset controls (Batch B).
 *
 * Candidates are inert until curated: only APPROVED versions can be inserted
 * as `muse-asset://` placeholders, and approval of the owning Forge job is
 * what embeds their bytes into the immutable artifact.
 */
export function MediaPanel({
  projectId,
  onInsert,
  onChanged,
}: {
  projectId: string;
  onInsert: (placeholder: string) => void;
  onChanged: () => void;
}) {
  const [assets, setAssets] = useState<MediaAssetSummaryView[]>([]);
  const [versions, setVersions] = useState<Record<string, MediaVersionRecordView[]>>({});
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<(typeof SIZES)[number]>('1024x1024');
  const [editTarget, setEditTarget] = useState<{ assetId: string; version: number } | null>(null);
  const [refTarget, setRefTarget] = useState<{ assetId: string; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, jobsResult] = await Promise.all([
        api.mediaAssets(projectId),
        api.mediaJobs(projectId),
      ]);
      setAssets(list.items);
      setJobs(jobsResult.items);
      const loaded = await Promise.all(
        list.items.map(async (asset) => {
          const items = await api.mediaVersions(projectId, asset.asset_id);
          return [asset.asset_id, items] as const;
        }),
      );
      setVersions(Object.fromEntries(loaded));
    } catch (error) {
      setNotice({ tone: 'err', text: messageOf(error) });
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll only while provider work is in flight.
  useEffect(() => {
    if (!jobs.some(isActive)) return;
    const timer = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(timer);
  }, [jobs, refresh]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await refresh();
      onChanged();
    } catch (error) {
      setNotice({ tone: 'err', text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File | undefined): void => {
    if (!file) return;
    void run(async () => {
      const { mime, dataBase64 } = await readBase64(file);
      await api.mediaUpload(projectId, { mime, dataBase64, sourceText: file.name });
      setNotice({ tone: 'ok', text: 'Uploaded as a candidate. Approve it to make it embeddable.' });
    });
  };

  const submitPrompt = (): void => {
    const text = prompt.trim();
    if (text.length === 0) return;
    const target = editTarget;
    void run(async () => {
      if (target) {
        await api.mediaEdit(projectId, {
          prompt: text,
          assetId: target.assetId,
          version: target.version,
          size,
        });
        setNotice({
          tone: 'ok',
          text: `Edit of v${target.version} queued. It arrives as a new candidate version.`,
        });
        setEditTarget(null);
      } else {
        await api.mediaGenerate(projectId, text, size);
        setNotice({ tone: 'ok', text: 'Generation queued. New candidates appear below.' });
      }
      setPrompt('');
    });
  };

  const curate = (assetId: string, version: number, action: 'approve' | 'reject'): void => {
    void run(async () => {
      await api.mediaCurate(projectId, assetId, version, action);
    });
  };

  return (
    <section aria-label="Media assets" className="panel shrink-0">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="layers" className="size-3.5 text-muted" />
          Media
        </h2>
        <span className="font-mono text-[10px] text-muted">{assets.length}</span>
      </div>

      <div className="space-y-2 border-b border-line/70 px-3 py-2.5">
        <div className="flex gap-1.5">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              editTarget
                ? `Describe a change to v${editTarget.version}`
                : 'Describe an image to generate'
            }
            aria-label={editTarget ? 'Image edit prompt' : 'Image prompt'}
            className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink placeholder:text-muted"
          />
          <button
            type="button"
            disabled={busy || prompt.trim().length === 0}
            onClick={submitPrompt}
            className="rounded bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink disabled:opacity-50"
          >
            {editTarget ? 'Edit' : 'Generate'}
          </button>
        </div>
        {editTarget ? (
          <div className="flex items-center gap-2 text-[10px] text-muted">
            <span className="font-mono">
              editing {editTarget.assetId.slice(0, 8)} v{editTarget.version}
            </span>
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="underline decoration-dotted"
            >
              cancel
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <select
            value={size}
            onChange={(event) => setSize(event.target.value as (typeof SIZES)[number])}
            aria-label="Image size"
            className="rounded border border-line bg-surface px-1.5 py-1 text-[10.5px] text-ink"
          >
            {SIZES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="rounded border border-line px-2 py-1 text-[10.5px] text-ink-dim disabled:opacity-50"
          >
            Upload
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              upload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {jobs.some(isActive) ? (
            <span className="ml-auto font-mono text-[10px] text-warn">
              {jobs.filter(isActive).length} running
            </span>
          ) : null}
        </div>
        {notice ? (
          <p className={`text-[10.5px] ${notice.tone === 'ok' ? 'text-ok' : 'text-err'}`}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto">
        {assets.map((asset) => {
          const items = versions[asset.asset_id] ?? [];
          const latest = items.at(-1);
          return (
            <li key={asset.asset_id} className="space-y-1.5 px-3 py-2">
              <div className="flex items-center gap-2">
                {latest ? (
                  <img
                    src={api.mediaBytesUrl(projectId, asset.asset_id, latest.version)}
                    alt={`Asset ${asset.asset_id.slice(0, 8)} version ${String(latest.version)}`}
                    className="size-10 shrink-0 rounded border border-line object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[10px] text-ink-dim">
                    {asset.asset_id.slice(0, 8)} · {asset.version_count} version
                    {asset.version_count === 1 ? '' : 's'}
                  </p>
                  <p className="text-[10px] text-muted">
                    {asset.approved_versions.length === 0
                      ? 'No approved version'
                      : `Approved: ${asset.approved_versions.map((v) => `v${v}`).join(', ')}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {items.map((version) => (
                  <span
                    key={version.version}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9.5px] ${
                      version.status === 'approved'
                        ? 'border-ok/40 text-ok'
                        : version.status === 'rejected'
                          ? 'border-line text-muted line-through'
                          : 'border-warn/40 text-warn'
                    }`}
                  >
                    v{version.version}
                    {version.status === 'candidate' ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => curate(asset.asset_id, version.version, 'approve')}
                          className="underline decoration-dotted"
                          title="Approve this version"
                        >
                          approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => curate(asset.asset_id, version.version, 'reject')}
                          className="underline decoration-dotted"
                          title="Reject this version"
                        >
                          reject
                        </button>
                      </>
                    ) : null}
                    {version.status === 'approved' ? (
                      <button
                        type="button"
                        onClick={() =>
                          onInsert(`muse-asset://${asset.asset_id}/v${version.version}`)
                        }
                        className="underline decoration-dotted"
                        title="Insert this reference into the instruction"
                      >
                        insert
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditTarget({ assetId: asset.asset_id, version: version.version });
                        setPrompt('');
                      }}
                      className="underline decoration-dotted"
                      title="Edit this version into a new candidate"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setRefTarget((current) =>
                          current?.assetId === asset.asset_id &&
                          current?.version === version.version
                            ? null
                            : { assetId: asset.asset_id, version: version.version },
                        )
                      }
                      className="underline decoration-dotted"
                      title="Suggest decisions or extract a cutout from this version"
                    >
                      reference
                    </button>
                  </span>
                ))}
              </div>
              {refTarget?.assetId === asset.asset_id ? (
                <ReferencePanel
                  key={`${projectId}:${refTarget.assetId}:${refTarget.version}`}
                  projectId={projectId}
                  assetId={refTarget.assetId}
                  version={refTarget.version}
                  onChanged={() => void refresh()}
                />
              ) : null}
            </li>
          );
        })}
        {assets.length === 0 ? (
          <li className="px-3 py-3 text-[10.5px] text-muted">No images yet.</li>
        ) : null}
      </ul>

      {jobs.length > 0 ? (
        <ul className="border-t border-line/70">
          {jobs.slice(0, 4).map((job) => (
            <li key={job.id} className="flex items-center gap-2 px-3 py-1.5 text-[10px]">
              <span className="font-mono text-ink-dim">{job.kind}</span>
              <span className="text-muted">{job.status}</span>
              {job.error ? <span className="truncate text-err">{job.error}</span> : null}
              <span className="ml-auto shrink-0 text-muted">
                {new Date(job.created_at).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              {isActive(job) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.mediaCancelJob(projectId, job.id);
                    })
                  }
                  className="shrink-0 underline decoration-dotted"
                >
                  cancel
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
