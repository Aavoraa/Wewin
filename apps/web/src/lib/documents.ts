import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from './api';

/**
 * Data + actions for a document page at `/${route}/:id` backed by `${endpoint}`.
 * Every action goes to an explicit API endpoint (post / cancel / close), never a status PATCH.
 */
export function useDocument<T extends { id: string; version: number }>(endpoint: string, route: string, id: string | undefined) {
  const isNew = !id || id === 'new';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = [endpoint, id];
  const query = useQuery({ queryKey: key, queryFn: () => api.get<T>(`${endpoint}/${id}`), enabled: !isNew });

  const set = (doc: T) => {
    qc.setQueryData([endpoint, doc.id], doc);
    void qc.invalidateQueries({ queryKey: [endpoint.replace(/^\//, '')] });
    void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('stock') });
  };

  return {
    isNew,
    query,
    doc: query.data,
    async save(payload: object) {
      if (isNew) {
        const created = await api.post<T>(endpoint, payload);
        set(created);
        navigate(`/${route}/${created.id}`, { replace: true });
        return created;
      }
      const updated = await api.patch<T>(`${endpoint}/${id}`, { ...payload, version: query.data?.version });
      set(updated);
      return updated;
    },
    async action(name: 'post' | 'cancel' | 'close' | string, body?: object) {
      const doc = await api.post<T>(`${endpoint}/${id}/${name}`, body ?? {});
      set(doc);
      return doc;
    },
    async remove() {
      await api.del(`${endpoint}/${id}`);
      void qc.invalidateQueries({ queryKey: [endpoint.replace(/^\//, '')] });
      navigate(`/${route}`);
    },
  };
}
