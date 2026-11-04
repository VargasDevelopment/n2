import { createN2Client, N2ApiError, N2ProtocolError, N2TransportError } from '@n2/client';
import { BUILD_COMMIT_HEADER } from '@n2/contracts';
import { updateWatch } from './appUpdate.js';

const client = createN2Client({
  // Everything the web interface sends is the person at the keyboard.
  actor: { kind: 'person' },
  // Read before the client parses the body, so a response this tab is too old to parse still
  // reveals the update that explains the failure.
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    updateWatch.observe(response.headers.get(BUILD_COMMIT_HEADER));
    return response;
  }
});

export const listProjects = client.listProjects;
export const createProject = client.createProject;
export const renameProject = client.renameProject;
export const archiveProject = client.archiveProject;
export const restoreProject = client.restoreProject;
export const getProject = client.getProject;
export const getExecution = client.getExecution;
export const previewGroupEnablement = client.previewGroupEnablement;
export const getApplicationPreferences = client.getApplicationPreferences;
export const updateApplicationPreference = client.updateApplicationPreference;
export const restoreApplicationPreference = client.restoreApplicationPreference;
export const getProjectSettings = client.getProjectSettings;
export const updateProjectSettingOverride = client.updateProjectSettingOverride;
export const clearProjectSettingOverride = client.clearProjectSettingOverride;
export const executeProjectCommand = client.executeCommand;
export const explainNode = client.explainNode;
export const getActivity = client.getActivity;
export const getLibraryActivity = client.getLibraryActivity;
export const markActivitySeen = client.markActivitySeen;
export const markLibraryActivitySeen = client.markLibraryActivitySeen;
export {
  N2ApiError as LocalApiError,
  N2ProtocolError as LocalProtocolError,
  N2TransportError as LocalTransportError
};
