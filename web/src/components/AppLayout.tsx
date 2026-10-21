import { SafetyCertificateOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { App as AntApp, Button, Layout, Menu, Select, Space, Tag, theme, Typography } from 'antd';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { meQuery } from '../api/queries';
import { NotFound } from './NotFound';
import { QueryState } from './QueryState';
import { useCurrentTenant } from './useCurrentTenant';

const SECTIONS = [
  { key: 'certificates', label: 'Certificates', icon: <SafetyCertificateOutlined aria-hidden /> },
  { key: 'bulk-issue', label: 'Bulk issue', icon: <SendOutlined aria-hidden /> },
] as const;

export function AppLayout() {
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const me = useQuery(meQuery);
  const tenant = useCurrentTenant();
  // Below the lg breakpoint the sidebar becomes a 64px icon rail (labels in tooltips) instead of
  // collapsing to 0px, which made antd float an expand tab over the page content.
  const [narrow, setNarrow] = useState(false);

  // /t/:tid/<section>/...
  const current = location.pathname.split('/')[3];
  const section = SECTIONS.find((s) => s.key === current)?.key ?? 'certificates';
  // Links never point at a tenant the admin cannot open, even while a foreign tid is in the URL.
  const navTid = tenant?.id ?? me.data?.tenants[0]?.id;

  const signOut = useMutation({
    mutationFn: () => api.signOut(),
    onSuccess: () => {
      void navigate('/sign-in', { replace: true });
      queryClient.clear();
      void message.success('Signed out');
    },
    onError: (err) => void message.error(err.message),
  });

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 16px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Typography.Text strong style={{ fontSize: token.fontSizeLG }}>
          Certificate Admin
        </Typography.Text>
        <div style={{ flex: 1 }} />
        {me.data && (
          <Space size="middle">
            <Select
              aria-label="Tenant"
              style={{ minWidth: 220 }}
              placeholder="Select tenant"
              value={tenant?.id}
              options={me.data.tenants.map((t) => ({ value: t.id, label: t.name }))}
              onChange={(id: number) => void navigate(`/t/${id}/${section}`)}
            />
            {tenant && <Tag>{tenant.timezone}</Tag>}
            <Typography.Text>{me.data.admin.name}</Typography.Text>
            <Button loading={signOut.isPending} onClick={() => signOut.mutate()}>
              Sign out
            </Button>
          </Space>
        )}
      </Layout.Header>
      <Layout>
        <Layout.Sider
          theme="light"
          width={200}
          collapsedWidth={64}
          breakpoint="lg"
          collapsed={narrow}
          onBreakpoint={setNarrow}
          trigger={null}
        >
          <Menu
            mode="inline"
            selectedKeys={[section]}
            style={{ height: '100%' }}
            items={SECTIONS.map((s) => ({
              key: s.key,
              icon: s.icon,
              label: navTid ? <Link to={`/t/${navTid}/${s.key}`}>{s.label}</Link> : s.label,
            }))}
          />
        </Layout.Sider>
        <Layout.Content style={{ padding: 24 }}>
          <QueryState
            isPending={me.isPending}
            isError={me.isError}
            error={me.error}
            onRetry={() => void me.refetch()}
          >
            {tenant ? <Outlet /> : <NotFound />}
          </QueryState>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
