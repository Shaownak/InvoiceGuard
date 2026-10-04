'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';

export interface SubmitState {
  pending: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
}

/**
 * Runs one async action at a time and turns API errors into a form message plus per-field
 * messages. `run` resolves to true when the action succeeded.
 */
export function useSubmit() {
  const [state, setState] = useState<SubmitState>({ pending: false, error: null, fieldErrors: {} });

  async function run(action: () => Promise<void>): Promise<boolean> {
    setState({ pending: true, error: null, fieldErrors: {} });
    try {
      await action();
      setState({ pending: false, error: null, fieldErrors: {} });
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        setState({ pending: false, error: err.message, fieldErrors: err.fieldErrors });
      } else {
        setState({
          pending: false,
          error: 'Something went wrong. Please try again.',
          fieldErrors: {},
        });
      }
      return false;
    }
  }

  return { ...state, run };
}
