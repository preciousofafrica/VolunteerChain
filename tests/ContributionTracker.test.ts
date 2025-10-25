import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_PROJECT_ID = 112;
const ERR_INVALID_VOLUNTEER = 102;
const ERR_INVALID_HOURS = 103;
const ERR_INVALID_EVIDENCE_HASH = 104;
const ERR_CONTRIB_ALREADY_EXISTS = 105;
const ERR_CONTRIB_NOT_FOUND = 106;
const ERR_ALREADY_VERIFIED = 108;
const ERR_INVALID_APPROVER = 111;
const ERR_MAX_APPROVERS_EXCEEDED = 113;

interface Contribution {
  volunteer: string;
  projectId: number;
  hours: number;
  evidenceHash: Uint8Array;
  timestamp: number;
  status: string;
  approvers: string[];
  approvalCount: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ContributionTrackerMock {
  state: {
    nextContribId: number;
    minApprovals: number;
    maxApprovers: number;
    authorityContract: string | null;
    contributions: Map<number, Contribution>;
    contributionsByVolunteer: Map<string, number>;
  } = {
    nextContribId: 0,
    minApprovals: 2,
    maxApprovers: 5,
    authorityContract: null,
    contributions: new Map(),
    contributionsByVolunteer: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1VOLUNTEER";
  authorities: Set<string> = new Set(["ST1VOLUNTEER", "ST2APPROVER"]);

  reset() {
    this.state = {
      nextContribId: 0,
      minApprovals: 2,
      maxApprovers: 5,
      authorityContract: null,
      contributions: new Map(),
      contributionsByVolunteer: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1VOLUNTEER";
    this.authorities = new Set(["ST1VOLUNTEER", "ST2APPROVER"]);
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") return { ok: false, value: false };
    if (this.state.authorityContract !== null) return { ok: false, value: false };
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMinApprovals(newMin: number): Result<boolean> {
    if (!this.state.authorityContract || newMin <= 0 || newMin > this.state.maxApprovers) {
      return { ok: false, value: false };
    }
    this.state.minApprovals = newMin;
    return { ok: true, value: true };
  }

  setMaxApprovers(newMax: number): Result<boolean> {
    if (!this.state.authorityContract || newMax <= 0 || newMax > 10) return { ok: false, value: false };
    this.state.maxApprovers = newMax;
    return { ok: true, value: true };
  }

  logContribution(projectId: number, hours: number, evidenceHash: Uint8Array): Result<number> {
    if (projectId <= 0) return { ok: false, value: ERR_INVALID_PROJECT_ID };
    if (this.caller === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_VOLUNTEER };
    if (hours <= 0 || hours > 1000) return { ok: false, value: ERR_INVALID_HOURS };
    if (evidenceHash.length === 0) return { ok: false, value: ERR_INVALID_EVIDENCE_HASH };
    const key = `${this.caller}-${projectId}`;
    if (this.state.contributionsByVolunteer.has(key)) return { ok: false, value: ERR_CONTRIB_ALREADY_EXISTS };
    const id = this.state.nextContribId;
    this.state.contributions.set(id, {
      volunteer: this.caller,
      projectId,
      hours,
      evidenceHash,
      timestamp: this.blockHeight,
      status: "pending",
      approvers: [],
      approvalCount: 0,
    });
    this.state.contributionsByVolunteer.set(key, id);
    this.state.nextContribId++;
    return { ok: true, value: id };
  }

  verifyContribution(contribId: number): Result<boolean> {
    const contrib = this.state.contributions.get(contribId);
    if (!contrib) return { ok: false, value: false };
    if (this.caller === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_APPROVER };
    if (contrib.status !== "pending") return { ok: false, value: ERR_ALREADY_VERIFIED };
    if (contrib.approvers.includes(this.caller)) return { ok: false, value: ERR_INVALID_APPROVER };
    if (contrib.approvers.length >= this.state.maxApprovers) return { ok: false, value: ERR_MAX_APPROVERS_EXCEEDED };
    const newApprovers = [...contrib.approvers, this.caller];
    const newCount = contrib.approvalCount + 1;
    const newStatus = newCount >= this.state.minApprovals ? "verified" : "pending";
    this.state.contributions.set(contribId, {
      ...contrib,
      approvers: newApprovers,
      approvalCount: newCount,
      status: newStatus,
    });
    return { ok: true, value: true };
  }

  rejectContribution(contribId: number): Result<boolean> {
    const contrib = this.state.contributions.get(contribId);
    if (!contrib) return { ok: false, value: false };
    if (this.caller === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_APPROVER };
    if (contrib.status !== "pending") return { ok: false, value: ERR_ALREADY_VERIFIED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.contributions.set(contribId, { ...contrib, status: "rejected" });
    return { ok: true, value: true };
  }

  getContribution(id: number): Contribution | null {
    return this.state.contributions.get(id) || null;
  }

  getContributionByVolunteer(volunteer: string, projectId: number): number | null {
    return this.state.contributionsByVolunteer.get(`${volunteer}-${projectId}`) || null;
  }
}

describe("ContributionTracker", () => {
  let contract: ContributionTrackerMock;
  const evidenceHash = new Uint8Array(32).fill(1);

  beforeEach(() => {
    contract = new ContributionTrackerMock();
    contract.reset();
  });

  it("logs contribution successfully", () => {
    contract.setAuthorityContract("ST2APPROVER");
    const result = contract.logContribution(1, 10, evidenceHash);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const contrib = contract.getContribution(0);
    expect(contrib?.volunteer).toBe("ST1VOLUNTEER");
    expect(contrib?.projectId).toBe(1);
    expect(contrib?.hours).toBe(10);
    expect(contrib?.status).toBe("pending");
    expect(contrib?.approvalCount).toBe(0);
  });

  it("rejects duplicate contribution", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.logContribution(1, 10, evidenceHash);
    const result = contract.logContribution(1, 20, evidenceHash);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONTRIB_ALREADY_EXISTS);
  });

  it("rejects invalid project ID", () => {
    contract.setAuthorityContract("ST2APPROVER");
    const result = contract.logContribution(0, 10, evidenceHash);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROJECT_ID);
  });

  it("rejects invalid hours", () => {
    contract.setAuthorityContract("ST2APPROVER");
    const result = contract.logContribution(1, 0, evidenceHash);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_HOURS);
  });

  it("rejects invalid evidence hash", () => {
    contract.setAuthorityContract("ST2APPROVER");
    const result = contract.logContribution(1, 10, new Uint8Array(0));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_EVIDENCE_HASH);
  });

  it("verifies contribution successfully", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.logContribution(1, 10, evidenceHash);
    contract.caller = "ST2APPROVER";
    const result = contract.verifyContribution(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const contrib = contract.getContribution(0);
    expect(contrib?.approvers).toEqual(["ST2APPROVER"]);
    expect(contrib?.approvalCount).toBe(1);
    expect(contrib?.status).toBe("pending");
    contract.caller = "ST3APPROVER";
    contract.verifyContribution(0);
    const updated = contract.getContribution(0);
    expect(updated?.approvalCount).toBe(2);
    expect(updated?.status).toBe("verified");
  });

  it("rejects verification for non-existent contribution", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.caller = "ST2APPROVER";
    const result = contract.verifyContribution(99);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects verification by same approver", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.logContribution(1, 10, evidenceHash);
    contract.caller = "ST2APPROVER";
    contract.verifyContribution(0);
    const result = contract.verifyContribution(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_APPROVER);
  });

  it("rejects verification for already verified contribution", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.logContribution(1, 10, evidenceHash);
    contract.caller = "ST2APPROVER";
    contract.verifyContribution(0);
    contract.caller = "ST3APPROVER";
    contract.verifyContribution(0);
    contract.caller = "ST4APPROVER";
    const result = contract.verifyContribution(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_VERIFIED);
  });

  it("rejects verification when max approvers exceeded", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.state.maxApprovers = 1;
    contract.logContribution(1, 10, evidenceHash);
    contract.caller = "ST2APPROVER";
    contract.verifyContribution(0);
    contract.caller = "ST3APPROVER";
    const result = contract.verifyContribution(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_APPROVERS_EXCEEDED);
  });

  it("rejects contribution with invalid volunteer", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.caller = "SP000000000000000000002Q6VF78";
    const result = contract.logContribution(1, 10, evidenceHash);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VOLUNTEER);
  });

  it("rejects verification with invalid approver", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.logContribution(1, 10, evidenceHash);
    contract.caller = "SP000000000000000000002Q6VF78";
    const result = contract.verifyContribution(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_APPROVER);
  });

  it("rejects contribution without authority contract", () => {
    const result = contract.logContribution(1, 10, evidenceHash);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
  });

  it("sets min approvals successfully", () => {
    contract.setAuthorityContract("ST2APPROVER");
    const result = contract.setMinApprovals(3);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.minApprovals).toBe(3);
  });

  it("rejects invalid min approvals", () => {
    contract.setAuthorityContract("ST2APPROVER");
    const result = contract.setMinApprovals(6);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets max approvers successfully", () => {
    contract.setAuthorityContract("ST2APPROVER");
    const result = contract.setMaxApprovers(7);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxApprovers).toBe(7);
  });

  it("rejects invalid max approvers", () => {
    contract.setAuthorityContract("ST2APPROVER");
    const result = contract.setMaxApprovers(11);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects contribution rejection without authority", () => {
    contract.logContribution(1, 10, evidenceHash);
    contract.caller = "ST2APPROVER";
    const result = contract.rejectContribution(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects contribution successfully", () => {
    contract.setAuthorityContract("ST2APPROVER");
    contract.logContribution(1, 10, evidenceHash);
    contract.caller = "ST2APPROVER";
    const result = contract.rejectContribution(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const contrib = contract.getContribution(0);
    expect(contrib?.status).toBe("rejected");
  });
});