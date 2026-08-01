/**
 * Placeholder shell. There is deliberately no UI yet — v1 session one built
 * `src/game/` only. Scene, field guide, notebook and dichotomous key come next,
 * and they depend on `src/game/`, never the reverse.
 */
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '38rem', margin: '4rem auto' }}>
      <h1>Mycelial Realms</h1>
      <p>
        An identification trainer for wild fungi. It teaches the process of identification, not
        answers, and it never tells you whether anything is safe to eat.
      </p>
      <p>
        Game logic is implemented and tested. Rendering and UI are not built yet — run{' '}
        <code>npm test</code>.
      </p>
    </main>
  );
}
