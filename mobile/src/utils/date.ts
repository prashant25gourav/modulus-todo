/**
 * Pure date formatting and calculation utilities for Modulus Todo.
 */

export const isOverdue = (deadlineToCheck: string | Date, completed: boolean = false): boolean => {
  if (completed) return false;
  const deadlineTime = new Date(deadlineToCheck).getTime();
  return deadlineTime < Date.now();
};

export const formatHumanDeadline = (dateInput: string | Date): string => {
  const target = new Date(dateInput);
  if (isNaN(target.getTime())) return '';

  const now = new Date();
  const isPast = target.getTime() < now.getTime();

  // Strip time for day comparisons
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneDayMs = 24 * 60 * 60 * 1000;
  const dayDiff = Math.round((targetDay.getTime() - today.getTime()) / oneDayMs);

  const hours = target.getHours();
  const minutes = target.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes < 10 ? `0${minutes}` : minutes;
  const timeStr = `${displayHours}:${displayMinutes} ${ampm}`;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[target.getMonth()];
  const dayNum = target.getDate();

  if (dayDiff === 0) {
    return isPast ? `Overdue today at ${timeStr}` : `Due today at ${timeStr}`;
  }
  if (dayDiff === 1) {
    return `Due tomorrow at ${timeStr}`;
  }
  if (dayDiff === -1) {
    return `Overdue yesterday at ${timeStr}`;
  }
  if (isPast) {
    return `Overdue (${monthName} ${dayNum}, ${timeStr})`;
  }
  return `Due ${monthName} ${dayNum}, ${timeStr}`;
};
