import React, { useEffect } from 'react';
import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import StudioLoop from './components/StudioLoop.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { Watch, Problem, Features, How, Engine, Guard, Evidence, ForJudges, BeyondGames, Gallery, Stack, Quickstart, ProofVsRoadmap, MemoryTimeline, Honesty, CTA, Footer } from './components/Sections.jsx';

const WATCH = ['watch', 'loop', 'timeline', 'how', 'evidence', 'judges', 'quickstart'];

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
        <section className="block" id="loop">
          <div className="container">
            <div className="section-head center">
              <p className="kicker">A closer look</p>
              <h2>See what a remembered decision changes.</h2>
              <p>
                Try the same request with a decision supplied, left out, or corrected. The
                example shows how the proposed change and advisory check respond.
              </p>
            </div>
            <StudioLoop />
          </div>
        </section>
        <How />
        <Watch />
        <Evidence />
        <Quickstart />
        <ForJudges />
        <ProofVsRoadmap />
        <Honesty />
        <Problem />
        <MemoryTimeline />
        <Features />
        <Engine />
        <Guard />
        <BeyondGames />
        <Gallery />
        <Stack />
        <CTA />
      </main>
      <Footer />
      <CommandPalette />
    </>
  );
}
