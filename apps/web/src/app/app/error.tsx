'use client';

import { Alert, Button } from '@/components/ui/primitives';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="error">Something went wrong loading this page.</Alert>
      <div>
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
