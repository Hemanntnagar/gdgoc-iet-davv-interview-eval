import { Router } from 'express';
import multer from 'multer';
import { badRequest, HttpError } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { parseWorkbook } from '../services/importer/parse.js';
import type { Store } from '../store/types.js';

/**
 * Workbook upload + import. Every worksheet is inspected (per-sheet header
 * detection); non-applicant sheets are audited with a reason, never silently
 * ignored. Import is an upsert keyed by (source_sheet, source_key) with
 * roll-number/email fallbacks.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

const ACCEPTED = ['.xlsx', '.xls', '.csv'];

export function applicantImportRoutes(store: Store): Router {
  const r = Router();

  const isAdmin = (req: AuthedRequest) => {
    if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
  };

  // Parse-only preview: sheet audit + mapped rows, nothing written.
  r.post('/admin/applicants/import/preview', requireAuth, (req: AuthedRequest, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        next(err instanceof HttpError ? err : badRequest(err.message));
        return;
      }
      try {
        isAdmin(req);
        const file = req.file;
        if (!file) throw badRequest('Attach the workbook as multipart field "file"');
        const lower = file.originalname.toLowerCase();
        if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
          throw badRequest(`Unsupported file type — expected ${ACCEPTED.join(', ')}`);
        }
        const report = parseWorkbook(file.buffer, file.originalname);
        res.json({
          file: report.file,
          sheets: report.sheets,
          errors: report.errors,
          intra_file_duplicates: report.intraFileDuplicates,
          applicants: report.applicants,
          applicant_count: report.applicants.length,
        });
      } catch (e) {
        next(e);
      }
    });
  });

  // Parse + persist (upsert).
  r.post('/admin/applicants/import', requireAuth, (req: AuthedRequest, res, next) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        next(err instanceof HttpError ? err : badRequest(err.message));
        return;
      }
      try {
        isAdmin(req);
        const file = req.file;
        if (!file) throw badRequest('Attach the workbook as multipart field "file"');
        const lower = file.originalname.toLowerCase();
        if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
          throw badRequest(`Unsupported file type — expected ${ACCEPTED.join(', ')}`);
        }
        const dryRun = req.query.dry_run === 'true' || req.body?.dry_run === 'true';
        const report = parseWorkbook(file.buffer, file.originalname);
        if (dryRun) {
          res.json({
            dry_run: true,
            file: report.file,
            sheets: report.sheets,
            parse_errors: report.errors,
            intra_file_duplicates: report.intraFileDuplicates,
            would_import: report.applicants.length,
          });
          return;
        }
        const result = await store.importApplicants(report.applicants, req.user!.id);
        await store.audit({
          actor_id: req.user!.id,
          action: 'applicants_imported',
          entity_type: 'workbook',
          entity_id: report.file,
          details: {
            file: report.file,
            created: result.created,
            updated: result.updated,
            skipped_duplicates: result.skipped_duplicates,
            errors: result.errors.length,
            sheets: report.sheets.length,
          },
        });
        res.status(201).json({
          file: report.file,
          sheets: report.sheets,
          parse_errors: report.errors,
          intra_file_duplicates: report.intraFileDuplicates,
          ...result,
        });
      } catch (e) {
        next(e);
      }
    });
  });

  return r;
}
