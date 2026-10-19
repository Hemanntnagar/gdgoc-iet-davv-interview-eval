import type { Candidate, TaskLink } from '../../lib/types';

function LinkList({ links, empty }: { links: TaskLink[]; empty: string }) {
  if (!links || links.length === 0) return <span className="muted">{empty}</span>;
  return (
    <ul className="link-list">
      {links.map((l, i) => (
        <li key={`${l.url}-${i}`}>
          {/* Only rendered when the URL actually came from the workbook / user input. */}
          <a href={l.url} target="_blank" rel="noreferrer noopener">
            {l.label || l.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Expanded applicant profile shown on the evaluation page: workbook-sourced
 * identity, vertical/shift/priority, links and task submissions.
 */
export function CandidateProfile({
  candidate,
  verticalName,
}: {
  candidate: Candidate;
  verticalName?: string | null;
}) {
  const extraEntries = Object.entries(candidate.source_extra ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== '',
  );
  return (
    <details className="card profile-card" open>
      <summary>
        <strong>Applicant profile</strong>
        <span className="muted" style={{ fontWeight: 400 }}>
          {' '}
          — vertical, shift, links and submitted task
        </span>
      </summary>
      <div className="profile-grid">
        <div>
          <span className="label">Vertical</span>
          <span>
            {verticalName || candidate.vertical_id ? (
              verticalName ?? 'Assigned'
            ) : (
              <span className="muted">Unassigned</span>
            )}
          </span>
        </div>
        <div>
          <span className="label">Shift</span>
          <span>{candidate.shift || <span className="muted">—</span>}</span>
        </div>
        <div>
          <span className="label">Priority</span>
          <span>{candidate.priority ?? <span className="muted">—</span>}</span>
        </div>
        <div>
          <span className="label">Email</span>
          <span>{candidate.email || <span className="muted">—</span>}</span>
        </div>
        <div>
          <span className="label">Roll number</span>
          <span>{candidate.roll_number || candidate.application_id || <span className="muted">—</span>}</span>
        </div>
        <div>
          <span className="label">Branch</span>
          <span>{candidate.branch || '—'}</span>
        </div>
        <div className="profile-wide">
          <span className="label">Submitted task</span>
          <LinkList links={candidate.task_links ?? []} empty="No task link recorded" />
        </div>
        <div className="profile-wide">
          <span className="label">External profiles</span>
          <LinkList links={candidate.external_profiles ?? []} empty="No profiles recorded" />
        </div>
        <div className="profile-wide">
          <span className="label">Message to the team</span>
          <p style={{ margin: 0 }}>{candidate.team_message || <span className="muted">—</span>}</p>
        </div>
        <div className="profile-wide">
          <span className="label">Remarks</span>
          <p style={{ margin: 0 }}>{candidate.remarks || <span className="muted">—</span>}</p>
        </div>
        {extraEntries.length > 0 && (
          <div className="profile-wide">
            <span className="label">Workbook columns (other)</span>
            <table className="data" style={{ marginTop: '0.25rem' }}>
              <tbody>
                {extraEntries.map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ whiteSpace: 'nowrap' }}>{k}</td>
                    <td>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(candidate.source_sheet || candidate.last_synced_at) && (
          <div className="profile-wide muted" style={{ fontSize: '0.8rem' }}>
            {candidate.source_sheet ? `Source: sheet “${candidate.source_sheet}”` : ''}
            {candidate.source_row ? ` · row ${candidate.source_row}` : ''}
            {candidate.last_synced_at ? ` · last synced ${new Date(candidate.last_synced_at).toLocaleString()}` : ''}
          </div>
        )}
      </div>
    </details>
  );
}
