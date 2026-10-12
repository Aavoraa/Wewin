import { Router } from 'express';
import { zProductionListQuery, zSewingEntryInput, zSewingEntryUpdate, zSewingIssueInput, zSewingIssueUpdate } from '@wewin/shared';
import { mountDocRoutes } from '../../core/doc-routes';
import { sewingService as s } from './sewing.service';

/** /api/v1/sewing-issues and /sewing-entries (A§8: post). */
export const sewingRouter = Router();
const perms = { view: 'sewing.view', create: 'sewing.create', post: 'sewing.post', cancel: 'sewing.cancel' } as const;

mountDocRoutes(sewingRouter, '/sewing-issues', {
  perms,
  listQuery: zProductionListQuery,
  createBody: zSewingIssueInput,
  updateBody: zSewingIssueUpdate,
  svc: {
    list: (q) => s.listIssues(q),
    get: (id) => s.getIssue(id),
    create: (b, u) => s.createIssue(b, u),
    update: (id, b) => s.updateIssue(id, b),
    remove: (id) => s.removeIssue(id),
    post: (id, u) => s.postIssue(id, u),
    cancel: (id, r, u) => s.cancelIssue(id, r, u),
  },
});

mountDocRoutes(sewingRouter, '/sewing-entries', {
  perms,
  listQuery: zProductionListQuery,
  createBody: zSewingEntryInput,
  updateBody: zSewingEntryUpdate,
  svc: {
    list: (q) => s.listEntries(q),
    get: (id) => s.getEntry(id),
    create: (b, u) => s.createEntry(b, u),
    update: (id, b) => s.updateEntry(id, b),
    remove: (id) => s.removeEntry(id),
    post: (id, u) => s.postEntry(id, u),
    cancel: (id, r, u) => s.cancelEntry(id, r, u),
  },
});
