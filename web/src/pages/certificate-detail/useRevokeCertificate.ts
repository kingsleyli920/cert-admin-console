import type { CertificateDetail } from '@cac/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { api } from '../../api';
import { ApiError } from '../../api/client';
import { certificateDetailQuery, tenantKey } from '../../api/queries';

/**
 * Revokes a certificate (the reason is trimmed by the client).
 * - Success: the returned detail goes straight into the cache; the tenant's other certificate
 *   queries (lists, other details) and the course counts become stale.
 * - 409 (someone revoked it first): warn and refetch the detail to show who did.
 * - Anything else: show the server's message. `onClose` is called only when the dialog is done.
 */
export function useRevokeCertificate(tid: number, id: number, onClose: () => void) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const detail = certificateDetailQuery(tid, id);

  return useMutation<CertificateDetail, Error, string>({
    mutationFn: (reason) => api.revokeCertificate(tid, id, reason),
    onSuccess: (updated) => {
      queryClient.setQueryData(detail.queryKey, updated);
      void queryClient.invalidateQueries({
        queryKey: tenantKey(tid, 'certificates'),
        // The detail just written is already current.
        predicate: (q) => q.queryKey.join('/') !== detail.queryKey.join('/'),
      });
      void queryClient.invalidateQueries({ queryKey: tenantKey(tid, 'courses') });
      void message.success('Certificate revoked');
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        void message.warning('This certificate was already revoked');
        void queryClient.invalidateQueries({ queryKey: detail.queryKey });
        onClose();
        return;
      }
      void message.error(err.message);
    },
  });
}
