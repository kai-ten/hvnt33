// Shared fictional test data.

export const original = 'On 2025-06-12, Jane Vale awarded a contract to Harbor Works. The allegation has not been independently verified.';
export const draftInput = {
  summary: 'An attributed, unverified contract claim.', questions: ['Obtain the original award notice.'],
  records: [
    { key: 'jane', title: 'Jane Vale', kind: 'Person', notes: 'Named in the supplied account.', eventDate: '', tags: 'procurement', quote: 'Jane Vale' },
    { key: 'harbor', title: 'Harbor Works', kind: 'Organization', notes: 'Reported recipient; not independently verified.', eventDate: '', tags: 'procurement', quote: 'Harbor Works' },
    { key: 'claim', title: 'Reported contract award', kind: 'Claim', notes: 'The supplied account says Jane Vale awarded a contract to Harbor Works; this remains unverified.', eventDate: '2025-06-12', tags: 'procurement', quote: original },
  ],
  connections: [{ fromKey: 'jane', toKey: 'harbor', label: 'reportedly awarded a contract to', notes: 'An allegation in the captured account.', quote: original }],
};
