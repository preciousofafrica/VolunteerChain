(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-PROJECT u101)
(define-constant ERR-INVALID-VOLUNTEER u102)
(define-constant ERR-INVALID-HOURS u103)
(define-constant ERR-INVALID-EVIDENCE-HASH u104)
(define-constant ERR-CONTRIB-ALREADY-EXISTS u105)
(define-constant ERR-CONTRIB-NOT-FOUND u106)
(define-constant ERR-INVALID-STATUS u107)
(define-constant ERR-ALREADY-VERIFIED u108)
(define-constant ERR-INVALID-TIMESTAMP u109)
(define-constant ERR-INSUFFICIENT-APPROVALS u110)
(define-constant ERR-INVALID-APPROVER u111)
(define-constant ERR-INVALID-PROJECT-ID u112)
(define-constant ERR-MAX-APPROVERS-EXCEEDED u113)

(define-data-var next-contrib-id uint u0)
(define-data-var min-approvals uint u2)
(define-data-var max-approvers uint u5)
(define-data-var authority-contract (optional principal) none)

(define-map contributions
  uint
  {
    volunteer: principal,
    project-id: uint,
    hours: uint,
    evidence-hash: (buff 32),
    timestamp: uint,
    status: (string-ascii 20),
    approvers: (list 5 principal),
    approval-count: uint
  }
)

(define-map contributions-by-volunteer
  { volunteer: principal, project-id: uint }
  uint)

(define-read-only (get-contribution (id uint))
  (map-get? contributions id)
)

(define-read-only (get-contribution-by-volunteer (volunteer principal) (project-id uint))
  (map-get? contributions-by-volunteer { volunteer: volunteer, project-id: project-id })
)

(define-read-only (get-min-approvals)
  (ok (var-get min-approvals))
)

(define-read-only (get-max-approvers)
  (ok (var-get max-approvers))
)

(define-private (validate-project-id (project-id uint))
  (if (> project-id u0)
      (ok true)
      (err ERR-INVALID-PROJECT-ID))
)

(define-private (validate-volunteer (volunteer principal))
  (if (not (is-eq volunteer 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-VOLUNTEER))
)

(define-private (validate-hours (hours uint))
  (if (and (> hours u0) (<= hours u1000))
      (ok true)
      (err ERR-INVALID-HOURS))
)

(define-private (validate-evidence-hash (hash (buff 32)))
  (if (> (len hash) u0)
      (ok true)
      (err ERR-INVALID-EVIDENCE-HASH))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-approver (approver principal))
  (if (not (is-eq approver 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-APPROVER))
)

(define-private (validate-status (status (string-ascii 20)))
  (if (or (is-eq status "pending") (is-eq status "verified") (is-eq status "rejected"))
      (ok true)
      (err ERR-INVALID-STATUS))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-volunteer contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-min-approvals (new-min uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (asserts! (and (> new-min u0) (<= new-min (var-get max-approvers))) (err ERR-INSUFFICIENT-APPROVALS))
    (var-set min-approvals new-min)
    (ok true)
  )
)

(define-public (set-max-approvers (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (asserts! (and (> new-max u0) (<= new-max u10)) (err ERR-MAX-APPROVERS-EXCEEDED))
    (var-set max-approvers new-max)
    (ok true)
  )
)

(define-public (log-contribution (project-id uint) (hours uint) (evidence-hash (buff 32)))
  (let (
        (contrib-id (var-get next-contrib-id))
        (volunteer tx-sender)
      )
    (try! (validate-project-id project-id))
    (try! (validate-volunteer volunteer))
    (try! (validate-hours hours))
    (try! (validate-evidence-hash evidence-hash))
    (asserts! (is-none (map-get? contributions-by-volunteer { volunteer: volunteer, project-id: project-id })) (err ERR-CONTRIB-ALREADY-EXISTS))
    (map-set contributions contrib-id
      {
        volunteer: volunteer,
        project-id: project-id,
        hours: hours,
        evidence-hash: evidence-hash,
        timestamp: block-height,
        status: "pending",
        approvers: (list ),
        approval-count: u0
      }
    )
    (map-set contributions-by-volunteer { volunteer: volunteer, project-id: project-id } contrib-id)
    (var-set next-contrib-id (+ contrib-id u1))
    (print { event: "contribution-logged", id: contrib-id, volunteer: volunteer, project-id: project-id })
    (ok contrib-id)
  )
)

(define-public (verify-contribution (contrib-id uint))
  (let (
        (contrib (unwrap! (map-get? contributions contrib-id) (err ERR-CONTRIB-NOT-FOUND)))
        (approver tx-sender)
        (current-approvers (get approvers contrib))
        (current-count (get approval-count contrib))
      )
    (try! (validate-approver approver))
    (asserts! (is-eq (get status contrib) "pending") (err ERR-ALREADY-VERIFIED))
    (asserts! (< (len current-approvers) (var-get max-approvers)) (err ERR-MAX-APPROVERS-EXCEEDED))
    (asserts! (not (is-some (index-of current-approvers approver))) (err ERR-INVALID-APPROVER))
    (let (
          (new-approvers (unwrap! (as-max-len? (append current-approvers approver) u5) (err ERR-MAX-APPROVERS-EXCEEDED)))
          (new-count (+ current-count u1))
          (new-status (if (>= new-count (var-get min-approvals)) "verified" "pending"))
        )
      (map-set contributions contrib-id
        {
          volunteer: (get volunteer contrib),
          project-id: (get project-id contrib),
          hours: (get hours contrib),
          evidence-hash: (get evidence-hash contrib),
          timestamp: (get timestamp contrib),
          status: new-status,
          approvers: new-approvers,
          approval-count: new-count
        }
      )
      (print { event: "contribution-verified", id: contrib-id, approver: approver, new-status: new-status })
      (ok true)
    )
  )
)

(define-public (reject-contribution (contrib-id uint))
  (let (
        (contrib (unwrap! (map-get? contributions contrib-id) (err ERR-CONTRIB-NOT-FOUND)))
        (approver tx-sender)
      )
    (try! (validate-approver approver))
    (asserts! (is-eq (get status contrib) "pending") (err ERR-ALREADY-VERIFIED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (map-set contributions contrib-id
      {
        volunteer: (get volunteer contrib),
        project-id: (get project-id contrib),
        hours: (get hours contrib),
        evidence-hash: (get evidence-hash contrib),
        timestamp: (get timestamp contrib),
        status: "rejected",
        approvers: (get approvers contrib),
        approval-count: (get approval-count contrib)
      }
    )
    (print { event: "contribution-rejected", id: contrib-id, approver: approver })
    (ok true)
  )
)