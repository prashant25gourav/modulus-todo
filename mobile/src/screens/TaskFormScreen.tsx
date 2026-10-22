import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../navigation/types';
import { useTasksStore } from '../store/tasks';
import { Priority } from '../api/tasks';
import { KeyboardSafeView } from '../components/KeyboardSafeView';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { theme } from '../theme';
import { formatHumanDeadline } from '../utils/date';

type Props = NativeStackScreenProps<AppStackParamList, 'TaskForm'>;

export const TaskFormScreen: React.FC<Props> = ({ route, navigation }) => {
  const existingTask = route.params?.task;
  const isEditing = Boolean(existingTask);

  const { createTask, updateTask } = useTasksStore();

  const [title, setTitle] = useState(existingTask?.title || '');
  const [description, setDescription] = useState(existingTask?.description || '');
  const [scheduledAt, setScheduledAt] = useState<Date>(
    existingTask?.scheduledAt ? new Date(existingTask.scheduledAt) : new Date()
  );
  const [deadline, setDeadline] = useState<Date>(
    existingTask?.deadline
      ? new Date(existingTask.deadline)
      : new Date(Date.now() + 24 * 60 * 60 * 1000)
  );
  const [priority, setPriority] = useState<Priority>(existingTask?.priority || 'medium');
  const [tags, setTags] = useState<string[]>(existingTask?.tags || []);
  const [tagInput, setTagInput] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [clientErrors, setClientErrors] = useState<{ title?: string; dates?: string }>({});

  // DateTimePicker state for Android 2-step (date then time)
  const [activePickerTarget, setActivePickerTarget] = useState<'scheduled' | 'deadline' | null>(null);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [showPicker, setShowPicker] = useState(false);

  const openPicker = (target: 'scheduled' | 'deadline') => {
    setActivePickerTarget(target);
    setPickerMode('date');
    setShowPicker(true);
  };

  const handlePickerChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (event.type === 'dismissed') {
      setShowPicker(false);
      setActivePickerTarget(null);
      return;
    }

    if (!selectedDate || !activePickerTarget) {
      setShowPicker(false);
      return;
    }

    const currentBase = activePickerTarget === 'scheduled' ? new Date(scheduledAt) : new Date(deadline);

    if (Platform.OS === 'android') {
      if (pickerMode === 'date') {
        // Step 1: Date selected. Save date part and prompt time.
        currentBase.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        if (activePickerTarget === 'scheduled') setScheduledAt(new Date(currentBase));
        else setDeadline(new Date(currentBase));

        // Switch to time picker
        setPickerMode('time');
      } else {
        // Step 2: Time selected. Save time part and finish.
        currentBase.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
        if (activePickerTarget === 'scheduled') setScheduledAt(new Date(currentBase));
        else setDeadline(new Date(currentBase));

        setShowPicker(false);
        setActivePickerTarget(null);
      }
    } else {
      // iOS
      if (activePickerTarget === 'scheduled') setScheduledAt(selectedDate);
      else setDeadline(selectedDate);
      setShowPicker(false);
      setActivePickerTarget(null);
    }
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setTagInput('');
      return;
    }
    if (tags.length >= 10) return;
    if (trimmed.length > 30) return;

    setTags([...tags, trimmed]);
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const validate = (): boolean => {
    const errors: { title?: string; dates?: string } = {};

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      errors.title = 'Title is required';
    } else if (trimmedTitle.length > 120) {
      errors.title = 'Title cannot exceed 120 characters';
    }

    // Client-side rule: deadline must be >= scheduledAt
    if (deadline.getTime() < scheduledAt.getTime()) {
      errors.dates = 'Deadline must be on or after scheduled date & time';
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    setServerError(null);
    if (!validate()) return;

    setIsSaving(true);
    try {
      if (isEditing && existingTask) {
        await updateTask(existingTask._id, {
          title: title.trim(),
          description: description.trim() || null,
          scheduledAt: scheduledAt.toISOString(),
          deadline: deadline.toISOString(),
          priority,
          tags,
        });
      } else {
        await createTask({
          title: title.trim(),
          description: description.trim() || undefined,
          scheduledAt: scheduledAt.toISOString(),
          deadline: deadline.toISOString(),
          priority,
          tags,
        });
      }

      navigation.goBack();
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message || 'Failed to save task. Please try again.';
      setServerError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardSafeView>
      <View style={styles.header}>
        <Text style={styles.title}>{isEditing ? 'Edit Task' : 'New Task'}</Text>
        <Text style={styles.subtitle}>
          {isEditing ? 'Update your task details' : 'Plan and schedule your next activity'}
        </Text>
      </View>

      {/* Inline Server Error */}
      {serverError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{serverError}</Text>
        </View>
      ) : null}

      {/* Title */}
      <Input
        label="Title *"
        placeholder="What needs to be done?"
        value={title}
        onChangeText={(text) => {
          setTitle(text);
          if (clientErrors.title) setClientErrors((prev) => ({ ...prev, title: undefined }));
        }}
        maxLength={120}
        error={clientErrors.title}
      />
      <Text style={styles.charCounter}>{title.length}/120</Text>

      {/* Description */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Add extra details, notes, or subtasks..."
          placeholderTextColor={theme.colors.textMuted}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={2000}
        />
        <Text style={styles.charCounter}>{description.length}/2000</Text>
      </View>

      {/* Dates Selection */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Scheduling</Text>

        <View style={styles.datePickerRow}>
          <View style={styles.dateColumn}>
            <Text style={styles.dateSubLabel}>Scheduled Start</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => openPicker('scheduled')}
              activeOpacity={0.7}
            >
              <Text style={styles.dateButtonText}>
                {formatHumanDeadline(scheduledAt)}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dateColumn}>
            <Text style={styles.dateSubLabel}>Deadline *</Text>
            <TouchableOpacity
              style={[
                styles.dateButton,
                clientErrors.dates ? styles.dateButtonError : null,
              ]}
              onPress={() => openPicker('deadline')}
              activeOpacity={0.7}
            >
              <Text style={styles.dateButtonText}>
                {formatHumanDeadline(deadline)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {clientErrors.dates ? (
          <Text style={styles.errorText}>{clientErrors.dates}</Text>
        ) : null}
      </View>

      {/* Priority Selector */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Priority</Text>
        <View style={styles.prioritySelector}>
          {(['low', 'medium', 'high'] as Priority[]).map((p) => {
            const isSelected = priority === p;
            return (
              <TouchableOpacity
                key={p}
                style={[
                  styles.priorityButton,
                  isSelected && styles.priorityButtonActive,
                  isSelected && p === 'high' && styles.priorityHighActive,
                  isSelected && p === 'medium' && styles.priorityMediumActive,
                  isSelected && p === 'low' && styles.priorityLowActive,
                ]}
                onPress={() => setPriority(p)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.priorityButtonText,
                    isSelected && styles.priorityButtonTextActive,
                  ]}
                >
                  {p.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Tags Input */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Tags (max 10)</Text>
        <View style={styles.tagInputRow}>
          <TextInput
            style={[styles.input, styles.tagInput]}
            placeholder="Add tag (e.g. backend, personal)"
            placeholderTextColor={theme.colors.textMuted}
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={handleAddTag}
            maxLength={30}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.addTagButton}
            onPress={handleAddTag}
            activeOpacity={0.7}
          >
            <Text style={styles.addTagText}>Add</Text>
          </TouchableOpacity>
        </View>

        {tags.length > 0 ? (
          <View style={styles.tagChipsList}>
            {tags.map((t) => (
              <View key={t} style={styles.tagChip}>
                <Text style={styles.tagChipText}>#{t}</Text>
                <TouchableOpacity
                  onPress={() => handleRemoveTag(t)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.tagRemoveText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* Native DateTimePicker Modal */}
      {showPicker ? (
        <DateTimePicker
          value={activePickerTarget === 'scheduled' ? scheduledAt : deadline}
          mode={pickerMode}
          display={Platform.OS === 'android' ? 'default' : 'spinner'}
          onChange={handlePickerChange}
        />
      ) : null}

      {/* Submit Button */}
      <Button
        title={isEditing ? 'Save Changes' : 'Create Task'}
        loading={isSaving}
        onPress={handleSave}
        style={styles.submitButton}
      />

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => navigation.goBack()}
        disabled={isSaving}
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
    </KeyboardSafeView>
  );
};

const styles = StyleSheet.create({
  header: {
    marginBottom: theme.spacing.lg,
  },
  title: {
    ...theme.typography.h2,
    color: theme.colors.primaryLight,
  },
  subtitle: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  errorBanner: {
    backgroundColor: theme.colors.errorBackground,
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  errorBannerText: {
    ...theme.typography.bodySmall,
    color: theme.colors.error,
    textAlign: 'center',
  },
  fieldGroup: {
    marginBottom: theme.spacing.md,
  },
  label: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
    fontWeight: '600',
  },
  charCounter: {
    ...theme.typography.caption,
    color: theme.colors.textMuted,
    textAlign: 'right',
    marginTop: 2,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    color: theme.colors.text,
    fontSize: theme.typography.body.fontSize,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  datePickerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateColumn: {
    flex: 1,
  },
  dateSubLabel: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginBottom: 4,
  },
  dateButton: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.sm + 4,
    paddingVertical: theme.spacing.sm + 2,
  },
  dateButtonError: {
    borderColor: theme.colors.error,
  },
  dateButtonText: {
    ...theme.typography.caption,
    color: theme.colors.text,
    fontWeight: '500',
  },
  errorText: {
    ...theme.typography.caption,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
  },
  prioritySelector: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 3,
  },
  priorityButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: theme.borderRadius.sm,
  },
  priorityButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  priorityLowActive: {
    backgroundColor: '#2563EB',
  },
  priorityMediumActive: {
    backgroundColor: '#D97706',
  },
  priorityHighActive: {
    backgroundColor: '#DC2626',
  },
  priorityButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  priorityButtonTextActive: {
    color: '#FFFFFF',
  },
  tagInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tagInput: {
    flex: 1,
  },
  addTagButton: {
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  addTagText: {
    ...theme.typography.bodySmall,
    color: theme.colors.primaryLight,
    fontWeight: '600',
  },
  tagChipsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: theme.spacing.sm,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 6,
  },
  tagChipText: {
    ...theme.typography.caption,
    color: theme.colors.text,
  },
  tagRemoveText: {
    color: theme.colors.textMuted,
    fontSize: 16,
    lineHeight: 16,
  },
  submitButton: {
    marginTop: theme.spacing.md,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  cancelButtonText: {
    ...theme.typography.bodySmall,
    color: theme.colors.textMuted,
  },
});
