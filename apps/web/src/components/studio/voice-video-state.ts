/**
 * Batch D — source-bound state for the voice/video panel.
 *
 * Every draft and every in-flight result is tied to the exact project and
 * source that produced it. Selection changes (including an upload, a project
 * switch, or a refreshed source list that drops the active source) advance
 * `operationToken` and clear drafts, so a late provider response can never be
 * rendered, proposed against, or used to clear the busy state of a newer
 * operation.
 */

import type {
  MediaClipResponse,
  MediaProposalMemoryType,
  MediaSourceRecordView,
  MediaTranscript,
} from '@mml/shared';

export interface SourceKey {
  project_id: string;
  source_id: string;
}

export interface VoiceVideoNotice {
  tone: 'ok' | 'err';
  text: string;
}

export interface TranscriptDraft {
  key: SourceKey;
  transcript: MediaTranscript;
  text: string;
  memoryType: MediaProposalMemoryType;
}

export interface ClipDraft {
  key: SourceKey;
  clip: MediaClipResponse;
  selected: number[];
  memoryType: MediaProposalMemoryType;
}

export interface VoiceVideoState {
  projectId: string;
  sources: MediaSourceRecordView[];
  activeId: string | null;
  operationToken: number;
  busy: boolean;
  transcript: TranscriptDraft | null;
  clip: ClipDraft | null;
  clipPrompt: string;
  notice: VoiceVideoNotice | null;
}

export type VoiceVideoAction =
  | { type: 'resetProject'; token: number; projectId: string }
  | { type: 'sourcesLoaded'; projectId: string; items: MediaSourceRecordView[] }
  | { type: 'select'; token: number; projectId: string; sourceId: string }
  | { type: 'uploadSucceeded'; token: number; record: MediaSourceRecordView }
  | { type: 'operationStarted'; token: number }
  | { type: 'operationSucceeded'; token: number; notice: VoiceVideoNotice }
  | { type: 'operationFailed'; token: number; notice: VoiceVideoNotice }
  | { type: 'operationFinished'; token: number }
  | {
      type: 'transcriptLoaded';
      token: number;
      key: SourceKey;
      transcript: MediaTranscript;
    }
  | { type: 'clipLoaded'; token: number; key: SourceKey; clip: MediaClipResponse }
  | { type: 'transcriptEdited'; key: SourceKey; text: string }
  | { type: 'transcriptTypeChanged'; key: SourceKey; memoryType: MediaProposalMemoryType }
  | { type: 'clipPromptChanged'; text: string }
  | { type: 'clipToggled'; key: SourceKey; index: number }
  | { type: 'clipTypeChanged'; key: SourceKey; memoryType: MediaProposalMemoryType }
  | { type: 'notice'; notice: VoiceVideoNotice | null };

export const DEFAULT_TRANSCRIPT_TYPE: MediaProposalMemoryType = 'technical_decision';
export const DEFAULT_CLIP_TYPE: MediaProposalMemoryType = 'preference';

export function sourceKey(projectId: string, sourceId: string): SourceKey {
  return { project_id: projectId, source_id: sourceId };
}

export function sameSourceKey(left: SourceKey | null, right: SourceKey | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.project_id === right.project_id &&
    left.source_id === right.source_id
  );
}

export function initialState(projectId: string): VoiceVideoState {
  return {
    projectId,
    sources: [],
    activeId: null,
    operationToken: 0,
    busy: false,
    transcript: null,
    clip: null,
    clipPrompt: '',
    notice: null,
  };
}

export function activeKey(state: VoiceVideoState): SourceKey | null {
  if (state.activeId === null) return null;
  if (!state.sources.some((source) => source.source_id === state.activeId)) return null;
  return sourceKey(state.projectId, state.activeId);
}

/** The transcript draft only when it belongs to the current active source. */
export function transcriptTarget(state: VoiceVideoState): TranscriptDraft | null {
  const key = activeKey(state);
  if (state.transcript === null || !sameSourceKey(state.transcript.key, key)) return null;
  return state.transcript;
}

/** The clip draft only when it belongs to the current active source. */
export function clipTarget(state: VoiceVideoState): ClipDraft | null {
  const key = activeKey(state);
  if (state.clip === null || !sameSourceKey(state.clip.key, key)) return null;
  return state.clip;
}

function clearDrafts(state: VoiceVideoState): VoiceVideoState {
  return {
    ...state,
    transcript: null,
    clip: null,
    clipPrompt: '',
  };
}

function invalidate(state: VoiceVideoState, token: number): VoiceVideoState {
  return {
    ...clearDrafts(state),
    operationToken: token,
    busy: false,
  };
}

function currentToken(state: VoiceVideoState): number {
  return state.operationToken + 1;
}

function isCurrentToken(state: VoiceVideoState, token: number): boolean {
  return token === state.operationToken;
}

export function voiceVideoReducer(
  state: VoiceVideoState,
  action: VoiceVideoAction,
): VoiceVideoState {
  switch (action.type) {
    case 'resetProject':
      return {
        ...initialState(action.projectId),
        operationToken: action.token,
      };
    case 'sourcesLoaded': {
      if (action.projectId !== state.projectId) return state;
      const activeStillPresent =
        state.activeId !== null &&
        action.items.some((source) => source.source_id === state.activeId);
      if (activeStillPresent) {
        return { ...state, sources: action.items };
      }
      const nextId = action.items[0]?.source_id ?? null;
      if (nextId === state.activeId) {
        return { ...state, sources: action.items };
      }
      return {
        ...invalidate(state, currentToken(state)),
        sources: action.items,
        activeId: nextId,
      };
    }
    case 'select': {
      if (action.projectId !== state.projectId) return state;
      if (action.sourceId === state.activeId) return state;
      return {
        ...invalidate(state, action.token),
        activeId: action.sourceId,
      };
    }
    case 'uploadSucceeded': {
      if (!isCurrentToken(state, action.token)) return state;
      if (action.record.project_id !== state.projectId) return state;
      const sources = [
        action.record,
        ...state.sources.filter((source) => source.source_id !== action.record.source_id),
      ].slice(0, 200);
      return {
        ...invalidate(state, currentToken(state)),
        sources,
        activeId: action.record.source_id,
        notice: {
          tone: 'ok',
          text:
            action.record.origin === 'recording'
              ? 'Recording ready. Transcribe it, edit the draft, then choose what to propose.'
              : 'Source ready. Nothing has been sent to a model yet.',
        },
      };
    }
    case 'operationStarted':
      // Equal is allowed so a token advanced by an automatic refresh cannot
      // collide with the next operation and leave it running without busy.
      if (action.token < state.operationToken) return state;
      return { ...state, operationToken: action.token, busy: true };
    case 'operationSucceeded':
      if (!isCurrentToken(state, action.token)) return state;
      return { ...state, busy: false, notice: action.notice };
    case 'operationFailed':
      if (!isCurrentToken(state, action.token)) return state;
      return { ...state, busy: false, notice: action.notice };
    case 'operationFinished':
      if (!isCurrentToken(state, action.token)) return state;
      return { ...state, busy: false };
    case 'transcriptLoaded': {
      if (!isCurrentToken(state, action.token)) return state;
      if (!sameSourceKey(action.key, activeKey(state))) return state;
      return {
        ...state,
        transcript: {
          key: action.key,
          transcript: action.transcript,
          text: action.transcript.transcript,
          memoryType: DEFAULT_TRANSCRIPT_TYPE,
        },
        notice: {
          tone: 'ok',
          text:
            action.transcript.transcript.trim().length === 0
              ? 'No speech was detected. You can still type what the recording meant.'
              : 'Transcript draft ready. Correct it before proposing anything.',
        },
      };
    }
    case 'clipLoaded': {
      if (!isCurrentToken(state, action.token)) return state;
      if (!sameSourceKey(action.key, activeKey(state))) return state;
      return {
        ...state,
        clip: {
          key: action.key,
          clip: action.clip,
          selected: [],
          memoryType: DEFAULT_CLIP_TYPE,
        },
        notice: {
          tone: 'ok',
          text:
            action.clip.observations.length === 0
              ? 'The model found no supported observations in this clip.'
              : 'Observations are drafts. Select only the ones the clip actually supports.',
        },
      };
    }
    case 'transcriptEdited': {
      if (state.transcript === null || !sameSourceKey(state.transcript.key, action.key)) {
        return state;
      }
      return { ...state, transcript: { ...state.transcript, text: action.text } };
    }
    case 'transcriptTypeChanged': {
      if (state.transcript === null || !sameSourceKey(state.transcript.key, action.key)) {
        return state;
      }
      return {
        ...state,
        transcript: { ...state.transcript, memoryType: action.memoryType },
      };
    }
    case 'clipPromptChanged':
      return { ...state, clipPrompt: action.text };
    case 'clipToggled': {
      if (state.clip === null || !sameSourceKey(state.clip.key, action.key)) return state;
      const selected = state.clip.selected.includes(action.index)
        ? state.clip.selected.filter((value) => value !== action.index)
        : [...state.clip.selected, action.index];
      return { ...state, clip: { ...state.clip, selected } };
    }
    case 'clipTypeChanged': {
      if (state.clip === null || !sameSourceKey(state.clip.key, action.key)) return state;
      return { ...state, clip: { ...state.clip, memoryType: action.memoryType } };
    }
    case 'notice':
      return { ...state, notice: action.notice };
  }
}
