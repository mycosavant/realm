/**
 * Placeholder shell. There is deliberately no interface yet: what an
 * examination hands the player is an open decision, and it determines the shape
 * of everything above `src/game/`.
 *
 * What this does do is import `src/content/`, so that the production bundle
 * proves the loader end to end. Without a live import the module tree-shakes
 * away and `npm run build` succeeds whether or not `data/` can reach a browser
 * at all.
 *
 * This is not the field guide. It lists what loaded and nothing about any of it.
 */
import { CONFUSION_SETS, SPECIES } from './content';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '38rem', margin: '4rem auto' }}>
      <h1>Mycelial Realms</h1>
      <p>
        An identification trainer for wild fungi. It teaches the process of identification, not
        answers, and it never tells you whether anything is safe to eat.
      </p>
      <p>
        Game logic is implemented and tested; the interface is not built yet — run{' '}
        <code>npm test</code>.
      </p>
      <h2>Content loaded</h2>
      <p>
        {SPECIES.length} taxa across {CONFUSION_SETS.length} confusion set
        {CONFUSION_SETS.length === 1 ? '' : 's'}.
      </p>
      <ul>
        {SPECIES.map((species) => (
          <li key={species.id}>
            <i>{species.scientificName}</i>
          </li>
        ))}
      </ul>
    </main>
  );
}
