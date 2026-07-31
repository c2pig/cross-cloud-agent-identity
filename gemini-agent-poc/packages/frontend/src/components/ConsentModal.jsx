export default function ConsentModal({ pendingConsent, onApprove, onDeny, busy }) {
  if (!pendingConsent) return null;

  return (
    <div className="modal-backdrop" data-testid="consent-modal">
      <div className="modal">
        <h2>Agent is requesting your approval</h2>
        <p>{pendingConsent.message}</p>
        <pre className="patch">{JSON.stringify(pendingConsent.proposedPatch, null, 2)}</pre>
        <p className="hint">
          This action requires your explicit delegation — the agent cannot save this change under
          its own identity. Approving mints a short-lived, single-use on-behalf-of token scoped
          only to this update.
        </p>
        <div className="actions">
          <button disabled={busy} onClick={onApprove} data-testid="consent-approve">
            Approve
          </button>
          <button disabled={busy} className="secondary" onClick={onDeny} data-testid="consent-deny">
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
