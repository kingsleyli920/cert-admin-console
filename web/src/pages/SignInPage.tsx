import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Card, Radio, Space, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { meQuery } from '../api/queries';
import { QueryState } from '../components/QueryState';

export function SignInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [adminId, setAdminId] = useState<string>();
  const admins = useQuery({ queryKey: ['admins'], queryFn: () => api.getAdmins() });

  const signIn = useMutation({
    mutationFn: async (id: string) => {
      await api.signIn(id);
      // Drop anything cached for a previous session, then learn who we are now.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'admins' });
      return queryClient.fetchQuery(meQuery);
    },
    onSuccess: (me) => {
      const first = me.tenants[0];
      void navigate(first ? `/t/${first.id}/certificates` : '/', { replace: true });
    },
    onError: (err) => void message.error(err.message),
  });

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '10vh 16px' }}>
      <Card style={{ width: 400, maxWidth: '100%' }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Certificate Admin
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Choose a demo admin to sign in as.
        </Typography.Paragraph>
        <QueryState
          isPending={admins.isPending}
          isError={admins.isError}
          error={admins.error}
          onRetry={() => void admins.refetch()}
          isEmpty={admins.data?.items.length === 0}
          empty={<Typography.Text type="secondary">No demo admins are available.</Typography.Text>}
        >
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Radio.Group
              aria-label="Admin"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value as string)}
              options={admins.data?.items.map((a) => ({ value: a.id, label: a.name }))}
              orientation="vertical"
            />
            <Button
              type="primary"
              block
              disabled={!adminId}
              loading={signIn.isPending}
              onClick={() => adminId && signIn.mutate(adminId)}
            >
              Sign in
            </Button>
          </Space>
        </QueryState>
      </Card>
    </div>
  );
}
