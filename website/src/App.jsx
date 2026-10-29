import React, { useEffect } from 'react';
import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import StudioLoop from './components/StudioLoop.jsx';
import { Problem, Features, How, Evidence, Gallery, Stack, Quickstart, Honesty, CTA, Footer } from './components/Sections.jsx';

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
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <span />
      </div>
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
        <Problem />
        <How />
        <Features />
        <Evidence />
        <Gallery />
        <Stack />
        <Quickstart />
        <Honesty />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
