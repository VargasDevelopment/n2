import { reloadForUpdate, useUpdateAvailable } from '../appUpdate.js';
import './UpdateBanner.css';

/**
 * While the server runs a different build than this tab, the one place to reload: always shown,
 * above every panel and modal, and not dismissable, because only a reload resolves it. Failures
 * elsewhere keep their own retries; this never replaces them.
 */
export function UpdateBanner() {
  if (!useUpdateAvailable()) return null;
  return (
    <aside className="update-banner" role="status" aria-label="N² update">
      <span>N² was updated. Reload to get the new version.</span>
      <button type="button" onClick={reloadForUpdate}>
        Reload
      </button>
    </aside>
  );
}
