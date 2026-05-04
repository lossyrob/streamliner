export interface NodeLaunchRecordPathStatus {
  cwdExists: boolean;
  pawWorkDirExists: boolean;
  workflowContextExists: boolean;
  streamlinerContextExists: boolean;
  contextPackageExists: boolean;
  contextFileExists: boolean;
  sdkSessionWorkspaceExists?: boolean;
  sdkSessionStateRootExists?: boolean;
}

export interface NodeLaunchRecord {
  id: string;
  graphPath: string;
  nodeId: string;
  projectKey: string;
  workstreamId: string;
  branch: string;
  workId: string;
  workTitle: string;
  cwd: string;
  pawWorkDir: string;
  workflowContextPath: string;
  streamlinerContextPath: string;
  contextPackagePath: string;
  contextFilePath: string;
  sdkSessionWorkspacePath?: string;
  sdkSessionStateRoot?: string;
  launchNonce: string | null;
  launchClaimRef: string | null;
  trackerUrl: string | null;
  createdAt: string;
  updatedAt: string;
  pathStatus: NodeLaunchRecordPathStatus;
}

export interface NodeLaunchRecordResponse {
  record: NodeLaunchRecord | null;
}
