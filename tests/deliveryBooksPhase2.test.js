const { doRangesOverlap, calculateBatchDetails } = require('../src/utils/rangeValidationHelper');

describe('Phase 2: Delivery Document Books API & Controller Unit Logic', () => {
  it('should prevent overlapping range batch creation logic', () => {
    const existingBatches = [
      { start_number: 1000, end_number: 1149 },
      { start_number: 1200, end_number: 1249 }
    ];

    const newBatchProposal1 = { start_number: 1100, end_number: 1199 };
    const newBatchProposal2 = { start_number: 1150, end_number: 1199 };

    const overlaps1 = existingBatches.some(b => doRangesOverlap(newBatchProposal1.start_number, newBatchProposal1.end_number, b.start_number, b.end_number));
    const overlaps2 = existingBatches.some(b => doRangesOverlap(newBatchProposal2.start_number, newBatchProposal2.end_number, b.start_number, b.end_number));

    expect(overlaps1).toBe(true);
    expect(overlaps2).toBe(false);
  });

  it('should split sub-books correctly with proper total & end numbers', () => {
    const batch = calculateBatchDetails(5000, 100, 4);
    expect(batch.total_documents).toBe(400);
    expect(batch.end_number).toBe(5399);
    expect(batch.subBooks).toHaveLength(4);
    expect(batch.subBooks[0].start_number).toBe(5000);
    expect(batch.subBooks[0].end_number).toBe(5099);
    expect(batch.subBooks[3].start_number).toBe(5300);
    expect(batch.subBooks[3].end_number).toBe(5399);
  });
});
