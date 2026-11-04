import { ProjectApplication } from '@n2/application';
import {
  ApplicationPreferencesSchema,
  CreateProjectResponseSchema,
  EffectiveProjectSettingsSchema
} from '@n2/contracts';
import type { ProjectRepository } from '@n2/db';
import { createTestProjectRepository } from '@n2/db/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('Settings API', () => {
  let directory: string;
  let repository: ProjectRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-server-settings-'));
    repository = createTestProjectRepository(join(directory, 'n2.sqlite'));
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads, updates, restores, overrides, and clears typed settings', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    const applicationDefaults = await app.request('/api/settings/application');
    expect(ApplicationPreferencesSchema.parse(await applicationDefaults.json()).values).toEqual({
      handleOrientation: 'horizontal',
      minimapVisible: true,
      theme: 'midnight'
    });

    const themed = await app.request('/api/settings/application/theme', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'mono' })
    });
    expect(ApplicationPreferencesSchema.parse(await themed.json()).storedValues).toEqual({
      theme: 'mono'
    });

    const updated = await app.request('/api/settings/application/handleOrientation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'vertical' })
    });
    expect(updated.status).toBe(200);
    expect(ApplicationPreferencesSchema.parse(await updated.json()).values.handleOrientation).toBe(
      'vertical'
    );

    const overridden = await app.request('/api/projects/default/settings/minimapVisible', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: false })
    });
    expect(EffectiveProjectSettingsSchema.parse(await overridden.json())).toMatchObject({
      projectId: 'default',
      effectiveValues: { handleOrientation: 'vertical', minimapVisible: false },
      sources: { handleOrientation: 'application', minimapVisible: 'project' },
      overrides: { minimapVisible: false }
    });

    const cleared = await app.request('/api/projects/default/settings/minimapVisible', {
      method: 'DELETE'
    });
    expect(EffectiveProjectSettingsSchema.parse(await cleared.json())).toMatchObject({
      effectiveValues: { handleOrientation: 'vertical', minimapVisible: true },
      sources: { handleOrientation: 'application', minimapVisible: 'application' },
      overrides: {}
    });

    const restored = await app.request('/api/settings/application/handleOrientation', {
      method: 'DELETE'
    });
    expect(ApplicationPreferencesSchema.parse(await restored.json()).values.handleOrientation).toBe(
      'horizontal'
    );
  });

  it('creates a Project and its initial overrides through one request', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    const projectId = '00000000-0000-4000-8000-000000000501';
    const created = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        name: 'Configured',
        referenceKey: 'CONFIG',
        settings: { handleOrientation: 'vertical', minimapVisible: false }
      })
    });
    expect(created.status).toBe(201);
    expect(CreateProjectResponseSchema.parse(await created.json()).project.id).toBe(projectId);

    const settings = await app.request(`/api/projects/${projectId}/settings`);
    expect(EffectiveProjectSettingsSchema.parse(await settings.json())).toMatchObject({
      effectiveValues: { handleOrientation: 'vertical', minimapVisible: false },
      sources: { handleOrientation: 'project', minimapVisible: 'project' }
    });

    const conflictingRetry = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        name: 'Configured',
        referenceKey: 'CONFIG',
        settings: { handleOrientation: 'horizontal', minimapVisible: false }
      })
    });
    expect(conflictingRetry.status).toBe(409);
    expect(await conflictingRetry.json()).toEqual({
      code: 'project_conflict',
      error: `Project ${projectId} already exists with different initial settings.`,
      details: { field: 'initialSettings', value: projectId }
    });
  });

  it('returns structured validation and missing-Project errors', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    const invalidKey = await app.request('/api/settings/application/fontSize', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 14 })
    });
    expect(invalidKey.status).toBe(400);
    expect(await invalidKey.json()).toMatchObject({ code: 'validation_error' });

    const invalidValue = await app.request('/api/settings/application/minimapVisible', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'false' })
    });
    expect(invalidValue.status).toBe(400);
    expect(await invalidValue.json()).toMatchObject({ code: 'validation_error' });

    const unknownTheme = await app.request('/api/settings/application/theme', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'neon' })
    });
    expect(unknownTheme.status).toBe(400);
    const unknownProjectTheme = await app.request('/api/projects/default/settings/theme', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'neon' })
    });
    expect(unknownProjectTheme.status).toBe(400);
    const pinnedTheme = await app.request('/api/projects/default/settings/theme', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'system' })
    });
    expect(EffectiveProjectSettingsSchema.parse(await pinnedTheme.json())).toMatchObject({
      effectiveValues: { theme: 'system' },
      applicationValues: { theme: 'midnight' },
      sources: { theme: 'project' },
      overrides: { theme: 'system' }
    });

    const missing = await app.request('/api/projects/missing/settings');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'not_found' });
  });
});
