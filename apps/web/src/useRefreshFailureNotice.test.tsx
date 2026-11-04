import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NotificationProvider } from './components/NotificationProvider.js';
import { useRefreshFailureNotice } from './useRefreshFailureNotice.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const MESSAGE = 'Could not refresh. Showing the last loaded version.';

it('keeps the notice past any toast lifetime until a refresh succeeds', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const load = vi.fn<() => Promise<string>>().mockResolvedValue('loaded');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function View() {
    const query = useQuery({ queryKey: ['view'], queryFn: load });
    useRefreshFailureNotice([query], MESSAGE);
    return <p>{query.data}</p>;
  }
  render(
    <QueryClientProvider client={client}>
      <NotificationProvider>
        <View />
      </NotificationProvider>
    </QueryClientProvider>
  );
  expect(await screen.findByText('loaded')).toBeTruthy();

  load.mockRejectedValue(new Error('Local service unavailable.'));
  await act(() => client.refetchQueries());
  expect(await screen.findByText(MESSAGE)).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByText(MESSAGE)).toBeTruthy();

  load.mockResolvedValue('loaded');
  await act(() => client.refetchQueries());
  await waitFor(() => expect(screen.queryByText(MESSAGE)).toBeNull());
});
