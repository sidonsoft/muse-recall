import React, { useEffect } from 'react';
import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import StudioLoop from './components/StudioLoop.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { Problem, Features, How, Engine, Guard, Evidence, ForJudges, BeyondGames, Gallery, Stack, Quickstart, ProofVsRoadmap, MemoryTimeline, Honesty, SiteVerified, CTA, Footer } from './components/Sections.jsx';

const WATCH = ['loop', 'timeline', 'how', 'evidence', 'quickstart'];

export default function App() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

    const spy = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const link = document.querySelector(`.nav-links a[href="#${e.target.id}"]`);
          if (!link) continue;
          if (e.isIntersecting) {
            document.querySelectorAll('.nav-links a').forEach((a) => a.classList.remove('active'));
            link.classList.add('active');
          }
        }
      },
      { rootMargin: '-40% 0px -50% 0px' }
    );
    WATCH.forEach((id) => {
      const el = document.getElementById(id);
      if (el) spy.observe(el);
    });

    return () => {
      io.disconnect();
      spy.disconnect();
    };
  }, []);

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <span />
      </div>
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <section className="block" id="loop" style={{ paddingTop: 40 }}>
          <div className="container">
            <div className="section-head center">
              <p className="kicker">The loop, interactively</p>
              <h2>One request. Three memory states.</h2>
              <p>
                Flip between supplying the project&apos;s remembered rule, not supplying it, and
                correcting it. Watch the staged diff and the advisory Decision Guard respond.
              </p>
            </div>
            <StudioLoop />
          </div>
        </section>
        <MemoryTimeline />
        <Problem />
        <How />
        <Features />
        <Engine />
        <Guard />
        <Evidence />
        <ForJudges />
        <BeyondGames />
        <Gallery />
        <Stack />
        <Quickstart />
        <ProofVsRoadmap />
        <Honesty />
        <SiteVerified />
        <CTA />
      </main>
      <Footer />
      <CommandPalette />
    </>
  );
}
