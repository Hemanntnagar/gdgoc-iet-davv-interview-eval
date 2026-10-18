import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  full_name: z.string().trim().min(1).max(200),
  // Role is intentionally absent: the backend always creates judges.
});

export const verifyPanelSchema = z.object({
  code: z.string().trim().min(4).max(32),
});

export const candidateFiltersSchema = z.object({
  search: z.string().trim().max(200).optional(),
  branch: z.string().trim().max(120).optional(),
  panelId: uuidSchema.optional(),
  interviewStatus: z
    .enum(['pending', 'in_progress', 'completed', 'no_show'])
    .optional(),
  shortlistingStatus: z
    .enum(['pending', 'shortlisted', 'waitlisted', 'rejected'])
    .optional(),
  evaluationStatus: z.enum(['not_started', 'in_progress', 'complete']).optional(),
  sort: z.enum(['name', 'branch', 'average', 'created']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});

export const candidateWriteSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  branch: z.string().trim().max(120).default(''),
  application_id: z.string().trim().max(80).nullable().optional(),
  panel_id: uuidSchema,
  interview_status: z
    .enum(['pending', 'in_progress', 'completed', 'no_show'])
    .optional(),
  shortlisting_status: z
    .enum(['pending', 'shortlisted', 'waitlisted', 'rejected'])
    .optional(),
  notes: z.string().max(5000).optional(),
});

export const candidatePatchSchema = candidateWriteSchema.partial();

export const evaluationSubmitSchema = z.object({
  id: uuidSchema,
  candidate_id: uuidSchema,
  round_id: uuidSchema,
  feedback: z.string().max(5000).default(''),
  overall_score: z.number().nullable().optional(),
  scores: z.record(z.number()).default({}),
  client_created_at: z.string().datetime().nullable().optional(),
  // Sync hint: replace own existing official evaluation when the round allows edits
  replace_existing: z.boolean().optional(),
});

export const syncSchema = z.object({
  evaluations: z.array(evaluationSubmitSchema).min(1).max(50),
});

export const evaluationPatchSchema = z.object({
  feedback: z.string().max(5000).default(''),
  overall_score: z.number().nullable().optional(),
  scores: z.record(z.number()).default({}),
});

export const panelCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  expected_evaluations: z.number().int().min(1).max(50).default(1),
});

export const panelPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
  expected_evaluations: z.number().int().min(1).max(50).optional(),
});

export const roundCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  is_open: z.boolean().default(true),
  allow_edit_after_submit: z.boolean().default(false),
  closes_at: z.string().datetime().nullable().optional(),
});

export const roundPatchSchema = roundCreateSchema.partial();

export const criterionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  min_score: z.number().min(0).max(1000).default(1),
  max_score: z.number().min(0.01).max(1000).default(10),
  weight: z.number().gt(0).max(100).default(1),
  sort_order: z.number().int().min(0).max(1000).default(0),
  is_active: z.boolean().default(true),
});

export const criterionPatchSchema = criterionSchema.partial();

export const codeCreateSchema = z.object({
  panel_id: uuidSchema,
  label: z.string().trim().max(120).default(''),
  // If provided, used verbatim (admin-supplied); otherwise generated server-side.
  code: z.string().trim().min(6).max(32).regex(/^[A-Za-z0-9]+$/, 'Letters and digits only').optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

export const roleUpdateSchema = z.object({
  role: z.enum(['judge', 'admin']),
});

export const judgeCreateSchema = z.object({
  email: z.string().email().max(200),
  full_name: z.string().trim().min(1).max(200),
});

export const resultsFilterSchema = candidateFiltersSchema;
