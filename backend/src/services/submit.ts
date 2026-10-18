import { computeOverallFromCriteria, round2, ScoreError, validateOverallScore } from '../lib/scoring.js';
import type {
  CriterionScore,
  Store,
  SubmitEvaluationInput,
  SubmitOutcome,
} from '../store/types.js';

/**
 * Shared evaluation-submission pipeline used by POST /evaluations and
 * POST /sync/evaluations. Validates round policy, panel membership and scores,
 * computes the overall score server-side, then applies duplicate/idempotency
 * rules in the store.
 */
export async function handleSubmission(
  store: Store,
  judgeId: string,
  input: SubmitEvaluationInput,
  opts: { replaceExisting: boolean },
): Promise<SubmitOutcome> {
  const round = await store.getRound(input.round_id);
  if (!round) return { status: 'error', message: 'Interview round not found' };
  if (!round.is_open) return { status: 'error', message: 'This interview round is closed' };
  if (round.closes_at && new Date(round.closes_at).getTime() < Date.now()) {
    return { status: 'error', message: 'This interview round has closed' };
  }
  const candidate = await store.getCandidate(input.candidate_id, { admin: true });
  if (!candidate || candidate.archived_at) {
    return { status: 'error', message: 'Candidate not found' };
  }
  const myPanels = await store.listMyPanels(judgeId);
  if (!myPanels.some((p) => p.id === candidate.panel_id)) {
    return { status: 'error', message: "You are not assigned to this candidate's panel" };
  }

  const activeCriteria = (await store.listCriteria(round.id)).filter((c) => c.is_active);
  let overallScore: number | null;
  let scores: CriterionScore[];
  try {
    if (activeCriteria.length > 0) {
      overallScore = computeOverallFromCriteria(
        activeCriteria.map((c) => ({
          id: c.id,
          min_score: Number(c.min_score),
          max_score: Number(c.max_score),
          weight: Number(c.weight),
        })),
        input.scores ?? {},
      );
      scores = activeCriteria.map((c) => ({
        criterion_id: c.id,
        score: round2(Number(input.scores[c.id])),
      }));
    } else {
      overallScore = validateOverallScore(input.overall_score);
      scores = [];
    }
  } catch (e) {
    if (e instanceof ScoreError) {
      return { status: 'error', message: 'Invalid scores', details: e.details };
    }
    throw e;
  }

  return store.submitEvaluation(
    judgeId,
    { ...input, overall_score: overallScore },
    { overall_score: overallScore, scores },
    opts,
  );
}
