/**
 * Names the commit the server was built from, on every response a deployed build's API answers. A
 * browser tab compares it with the commit its own bundle was built from, so a tab left open
 * across a deploy can offer a reload instead of failing on responses it cannot parse.
 */
export const BUILD_COMMIT_HEADER = 'n2-build-commit';
