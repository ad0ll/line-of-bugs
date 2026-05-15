'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { SubjectTypeChips, type SubjectValue, type SubjectCounts } from './SubjectTypeChips';
import { InstitutionPicker } from './InstitutionPicker';

export interface FilterChipsControlsProps {
  subjectCounts: SubjectCounts;
  institutions: { name: string; count: number }[];
}

export function FilterChipsControls({ subjectCounts, institutions }: FilterChipsControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const subject = (params.get('subject') as SubjectValue) ?? 'both';
  const instStr = params.get('inst') ?? '';
  const selectedInst = instStr ? instStr.split(',').filter(Boolean) : [];

  const pushNext = useCallback(
    (mut: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params);
      mut(next);
      next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, router, pathname],
  );

  function setSubject(v: SubjectValue) {
    pushNext((next) => {
      if (v === 'both') next.delete('subject');
      else next.set('subject', v);
    });
  }

  function setInstitutions(names: string[]) {
    pushNext((next) => {
      if (names.length === 0) next.delete('inst');
      else next.set('inst', names.join(','));
    });
  }

  return (
    <>
      <SubjectTypeChips value={subject} counts={subjectCounts} onChange={setSubject} />
      <InstitutionPicker institutions={institutions} selected={selectedInst} onChange={setInstitutions} />
    </>
  );
}
