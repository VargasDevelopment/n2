import type { ApplicationPreferenceValues } from '@n2/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Any settings record: the Application Preferences, or the subset a Project resolves.
export type AnySettings = Partial<ApplicationPreferenceValues>;

export type SettingValueIntent<Values extends AnySettings> = {
  [Key in keyof Values]-?: { key: Key; value: Values[Key] };
}[keyof Values];

type Failure<Intent> = {
  intent: Intent;
  message: string;
};

const applyIntent = <Values extends AnySettings>(
  values: Values,
  intent: SettingValueIntent<Values>
): Values => ({ ...values, [intent.key]: intent.value });

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'N² could not save this setting.';

export function useImmediateSettings<
  Values extends AnySettings,
  Intent extends SettingValueIntent<Values>
>({
  durableValues,
  execute,
  onPendingChange
}: {
  durableValues: Values;
  execute: (intent: Intent) => Promise<Values>;
  onPendingChange?: (pending: boolean) => void;
}) {
  type Key = keyof Values;
  const [previewValues, setPreviewValues] = useState(durableValues);
  const [pendingChange, setPendingChange] = useState<Intent | null>(null);
  const [failures, setFailures] = useState<Partial<Record<Key, Failure<Intent>>>>({});
  const [saved, setSaved] = useState<{ key: Key; nonce: number } | null>(null);
  const pendingRef = useRef(false);
  const durableValuesRef = useRef(durableValues);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    durableValuesRef.current = durableValues;
    if (!pendingRef.current) setPreviewValues(durableValues);
  }, [durableValues]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );

  const run = useCallback(
    async (intent: Intent, previewBase?: Values): Promise<void> => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      onPendingChange?.(true);
      setPendingChange(intent);
      setFailures((current) => {
        const next = { ...current };
        delete next[intent.key];
        return next;
      });
      setSaved(null);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      setPreviewValues((current) => applyIntent(previewBase ?? current, intent));
      try {
        const committedValues = await execute(intent);
        setPreviewValues(committedValues);
        setSaved((current) => ({ key: intent.key, nonce: (current?.nonce ?? 0) + 1 }));
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(null), 1800);
      } catch (cause) {
        setPreviewValues(durableValuesRef.current);
        setFailures((current) => ({
          ...current,
          [intent.key]: { intent, message: errorMessage(cause) }
        }));
      } finally {
        pendingRef.current = false;
        setPendingChange(null);
        onPendingChange?.(false);
      }
    },
    [execute, onPendingChange]
  );

  return {
    apply: (intent: Intent) => run(intent),
    failures,
    pendingChange,
    previewValues,
    retry: (key: Key) => {
      const failure = failures[key];
      return failure ? run(failure.intent, durableValuesRef.current) : Promise.resolve();
    },
    saved
  };
}

export type ImmediateSettings<
  Values extends AnySettings,
  Intent extends SettingValueIntent<Values>
> = ReturnType<typeof useImmediateSettings<Values, Intent>>;
