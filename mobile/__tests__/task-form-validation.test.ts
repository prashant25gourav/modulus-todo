describe('Task Form Client Validation', () => {
  const validateTaskForm = (params: {
    title: string;
    scheduledAt: Date;
    deadline: Date;
  }) => {
    const errors: { title?: string; dates?: string } = {};

    const trimmedTitle = params.title.trim();
    if (!trimmedTitle) {
      errors.title = 'Title is required';
    } else if (trimmedTitle.length > 120) {
      errors.title = 'Title cannot exceed 120 characters';
    }

    if (params.deadline.getTime() < params.scheduledAt.getTime()) {
      errors.dates = 'Deadline must be on or after scheduled date & time';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  };

  it('rejects creation when deadline is before scheduled date & time', () => {
    const scheduled = new Date('2026-10-22T14:00:00.000Z');
    const deadline = new Date('2026-10-22T10:00:00.000Z'); // 4 hours earlier

    const result = validateTaskForm({
      title: 'Valid Task Title',
      scheduledAt: scheduled,
      deadline,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.dates).toBe('Deadline must be on or after scheduled date & time');
  });

  it('rejects creation when title is empty or exceeds 120 characters', () => {
    const scheduled = new Date('2026-10-22T10:00:00.000Z');
    const deadline = new Date('2026-10-22T14:00:00.000Z');

    const emptyResult = validateTaskForm({
      title: '   ',
      scheduledAt: scheduled,
      deadline,
    });
    expect(emptyResult.isValid).toBe(false);
    expect(emptyResult.errors.title).toBe('Title is required');

    const longResult = validateTaskForm({
      title: 'a'.repeat(121),
      scheduledAt: scheduled,
      deadline,
    });
    expect(longResult.isValid).toBe(false);
    expect(longResult.errors.title).toBe('Title cannot exceed 120 characters');
  });

  it('accepts valid input when deadline is on or after scheduledAt and title is within range', () => {
    const scheduled = new Date('2026-10-22T10:00:00.000Z');
    const deadline = new Date('2026-10-22T10:00:00.000Z'); // Equal is valid

    const result = validateTaskForm({
      title: 'Complete Mobile Stage 2 Implementation',
      scheduledAt: scheduled,
      deadline,
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });
});
