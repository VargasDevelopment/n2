import { createContext, useContext, type ReactNode } from 'react';

export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'destructive';
};

/** Resolves true only when the person chooses the confirming action. */
export type Confirm = (request: ConfirmRequest) => Promise<boolean>;

export const ConfirmContext = createContext<Confirm | null>(null);

export const useConfirm = (): Confirm => {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('Confirmation requires a ConfirmProvider.');
  return confirm;
};
