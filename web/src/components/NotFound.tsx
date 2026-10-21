import { useQuery } from '@tanstack/react-query';
import { Button, Result } from 'antd';
import { useNavigate } from 'react-router';
import { meQuery } from '../api/queries';

/** Deliberately says nothing about why: a foreign tenant looks the same as a missing page. */
export function NotFound() {
  const navigate = useNavigate();
  const { data } = useQuery(meQuery);
  const first = data?.tenants[0];
  const home = first ? `/t/${first.id}/certificates` : '/';

  return (
    <Result
      status="404"
      title="Page not found"
      subTitle="The page you are looking for does not exist."
      extra={
        <Button type="primary" onClick={() => void navigate(home)}>
          {first ? 'Back to certificates' : 'Back to home'}
        </Button>
      }
    />
  );
}
