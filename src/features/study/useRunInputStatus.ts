import { useEffect, useState } from 'react';
import { runInputStatus } from '../../../study-run.mjs';

type InputStatus = { kind: string; message: string };
const checking = { kind: 'checking', message: 'Checking input identity…' };

export function useRunInputStatus(project: Record<string, unknown>, capture: unknown, trusted: boolean): InputStatus {
  const [checked, setChecked] = useState<{ project: unknown; capture: unknown; trusted: boolean; status: InputStatus } | null>(null);
  useEffect(() => {
    let active = true;
    const save = (status: InputStatus) => { if (active) setChecked({ project, capture, trusted, status }); };
    if (!trusted) save({ kind: 'unknown', message: 'Imported input metadata is unverified.' });
    else void runInputStatus(project, capture).then(save);
    return () => { active = false; };
  }, [project, capture, trusted]);
  // Reject the preceding identity synchronously while a new project/input is checked.
  return checked?.project === project && checked.capture === capture && checked.trusted === trusted ? checked.status : checking;
}
