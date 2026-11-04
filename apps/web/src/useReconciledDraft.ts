import { useEffect, useRef, useState } from 'react';

export function useReconciledDraft<Value>(
  authoritativeValue: Value,
  equals: (left: Value, right: Value) => boolean = Object.is
) {
  const [draft, setDraft] = useState(authoritativeValue);
  const editRevision = useRef(0);
  const cleanRevision = useRef(0);
  const submittedRevision = useRef(0);
  const observedAuthoritativeValue = useRef(authoritativeValue);

  useEffect(() => {
    if (equals(observedAuthoritativeValue.current, authoritativeValue)) return;
    observedAuthoritativeValue.current = authoritativeValue;
    if (editRevision.current !== cleanRevision.current) return;
    setDraft(authoritativeValue);
  }, [authoritativeValue, equals]);

  return {
    draft,
    edit(nextDraft: Value): void {
      editRevision.current += 1;
      setDraft(nextDraft);
    },
    /**
     * Takes the latest edit for saving, at most once: null when it is already clean or already
     * taken, so a blur, a Done and an unmount never send one edit twice.
     */
    submit(): number | null {
      const revision = editRevision.current;
      if (revision === cleanRevision.current || revision === submittedRevision.current) return null;
      submittedRevision.current = revision;
      return revision;
    },
    beginSave(): number {
      return editRevision.current;
    },
    reconcile(submittedRevision: number, acceptedValue: Value): void {
      if (editRevision.current !== submittedRevision) return;
      cleanRevision.current = editRevision.current;
      setDraft(acceptedValue);
    }
  };
}
