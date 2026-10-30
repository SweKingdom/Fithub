import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { createClass } from '../api/classes';
import { getClubs, getInstructors, type Club, type Instructor } from '../api/clubs';
import { useAuth } from '../lib/auth';
import {
  CLASS_FORM_FIELDS,
  validateClassForm,
  type ClassFormErrors,
  type ClassFormField,
  type ClassFormValues,
} from '../lib/class-form';
import { clubLocalToUtc } from '../lib/time';

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const NO_INSTRUCTOR = '';

/** DOM id of the input that receives focus for a field error. */
function focusId(field: ClassFormField, values: ClassFormValues): string {
  switch (field) {
    case 'name':
      return 'class-name';
    case 'startAt':
      return values.date === '' ? 'class-date' : 'class-time';
    case 'durationMinutes':
      return 'class-duration';
    case 'capacity':
      return 'class-capacity';
    case 'instructorId':
      return 'class-instructor';
  }
}

function focusFirstInvalid(errors: ClassFormErrors, values: ClassFormValues): void {
  const first = CLASS_FORM_FIELDS.find((field) => errors[field] !== undefined);
  if (first) document.getElementById(focusId(first, values))?.focus();
}

function toStartAt(values: ClassFormValues, timezone: string): string | null {
  try {
    return clubLocalToUtc(values.date, values.time, timezone);
  } catch {
    return null;
  }
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}

function NewClassForm() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [club, setClub] = useState<Club | null>(null);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [errors, setErrors] = useState<ClassFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [values, setValues] = useState<ClassFormValues>({
    name: '',
    date: '',
    time: '',
    duration: '',
    capacity: '',
  });
  const [instructorId, setInstructorId] = useState(NO_INSTRUCTOR);

  const clubId = me?.clubId ?? null;
  const isManager = me?.role === 'club_manager';

  useEffect(() => {
    if (clubId === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([getClubs(), isManager ? getInstructors(clubId) : Promise.resolve([])])
      .then(([clubs, list]) => {
        if (cancelled) return;
        setClub(clubs.find((candidate) => candidate.id === clubId) ?? null);
        setInstructors(list);
      })
      .catch(() => {
        if (!cancelled) setBanner(GENERIC_ERROR);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clubId, isManager]);

  if (loading) return <p>Loading…</p>;
  if (!me || clubId === null || !club) {
    return <p role="alert">{banner ?? GENERIC_ERROR}</p>;
  }

  const update = (key: keyof ClassFormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const showErrors = (next: ClassFormErrors) => {
    setErrors(next);
    focusFirstInvalid(next, values);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setBanner(null);

    const startAt = toStartAt(values, club.timezone);
    const clientErrors = validateClassForm(values, startAt, new Date());
    if (Object.keys(clientErrors).length > 0 || startAt === null) {
      showErrors(clientErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await createClass({
        clubId,
        name: values.name.trim(),
        startAt,
        durationMinutes: Number(values.duration),
        capacity: Number(values.capacity),
        ...(isManager ? { instructorId: instructorId === NO_INSTRUCTOR ? null : instructorId } : {}),
      });
      navigate(`/schedule?clubId=${encodeURIComponent(clubId)}`, { state: { flash: 'Class created.' } });
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiError && error.fieldErrors && error.fieldErrors.length > 0) {
        const serverErrors: ClassFormErrors = {};
        for (const { field, message } of error.fieldErrors) {
          const known = CLASS_FORM_FIELDS.find((candidate) => candidate === field);
          if (known && serverErrors[known] === undefined) serverErrors[known] = message;
        }
        if (Object.keys(serverErrors).length > 0) {
          showErrors(serverErrors);
          return;
        }
      }
      setBanner(error instanceof ApiError ? error.message : GENERIC_ERROR);
    }
  };

  const describe = (field: ClassFormField) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${field}-error` } : {};

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <h1>New class</h1>
      {banner && <p role="alert">{banner}</p>}

      <p>
        Club: <strong>{me.clubName}</strong>
      </p>

      <label htmlFor="class-name">Name</label>
      <input
        id="class-name"
        type="text"
        maxLength={100}
        required
        value={values.name}
        onChange={update('name')}
        {...describe('name')}
      />
      <FieldError id="name-error" message={errors.name} />

      <label htmlFor="class-date">Date</label>
      <input
        id="class-date"
        type="date"
        required
        value={values.date}
        onChange={update('date')}
        {...describe('startAt')}
      />

      <label htmlFor="class-time">Start time</label>
      <input
        id="class-time"
        type="time"
        required
        value={values.time}
        onChange={update('time')}
        {...describe('startAt')}
      />
      <FieldError id="startAt-error" message={errors.startAt} />

      <label htmlFor="class-duration">Duration (minutes)</label>
      <input
        id="class-duration"
        type="number"
        min={1}
        step={1}
        required
        value={values.duration}
        onChange={update('duration')}
        {...describe('durationMinutes')}
      />
      <FieldError id="durationMinutes-error" message={errors.durationMinutes} />

      <label htmlFor="class-capacity">Max places</label>
      <input
        id="class-capacity"
        type="number"
        min={1}
        step={1}
        required
        value={values.capacity}
        onChange={update('capacity')}
        {...describe('capacity')}
      />
      <FieldError id="capacity-error" message={errors.capacity} />

      {isManager && (
        <>
          <label htmlFor="class-instructor">Instructor</label>
          <select
            id="class-instructor"
            value={instructorId}
            onChange={(event) => setInstructorId(event.target.value)}
            {...describe('instructorId')}
          >
            <option value={NO_INSTRUCTOR}>No instructor yet</option>
            {instructors.map((instructor) => (
              <option key={instructor.id} value={instructor.id}>
                {instructor.fullName}
              </option>
            ))}
          </select>
          <FieldError id="instructorId-error" message={errors.instructorId} />
        </>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create class'}
      </button>
    </form>
  );
}

/** Route guard + form. Members see a "not allowed" page; the API enforces the same rule. */
export default function NewClassPage() {
  const { me } = useAuth();
  if (!me || (me.role !== 'instructor' && me.role !== 'club_manager')) {
    return <p>You are not allowed to create classes.</p>;
  }
  return <NewClassForm />;
}
