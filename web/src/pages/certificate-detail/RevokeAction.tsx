import { Button, Form, Input, Modal, Typography } from 'antd';
import { useRef, useState } from 'react';
import { useRevokeCertificate } from './useRevokeCertificate';

const MAX_REASON = 500;

interface Props {
  tid: number;
  id: number;
  serial: string;
  /** Only a valid certificate can be revoked; the dialog stays mounted to finish its close animation. */
  canRevoke: boolean;
}

/** "Revoke certificate" button and its confirmation dialog with a required reason. */
export function RevokeAction({ tid, id, serial, canRevoke }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ reason: string }>();
  const revoke = useRevokeCertificate(tid, id, () => setOpen(false));
  const pending = revoke.isPending;

  const openDialog = () => {
    // Every opening starts clean, whatever happened in the last one.
    form.resetFields();
    revoke.reset();
    setOpen(true);
  };

  // Validation is async, so `pending` alone would let a fast double click through.
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current || pending) return;
    submitting.current = true;
    try {
      const { reason } = await form.validateFields();
      await revoke.mutateAsync(reason);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <>
      {canRevoke && (
        <Button danger onClick={openDialog}>
          Revoke certificate
        </Button>
      )}
      <Modal
        title={`Revoke certificate ${serial}?`}
        open={open}
        okText="Revoke"
        okButtonProps={{ danger: true, loading: pending }}
        cancelButtonProps={{ disabled: pending }}
        closable={!pending}
        mask={{ closable: !pending }}
        keyboard={!pending}
        // Validation and request errors are shown by the form and the hook; nothing to add here.
        onOk={() => void submit().catch(() => undefined)}
        onCancel={() => setOpen(false)}
      >
        <Typography.Paragraph>
          The certificate stays on record as revoked and cannot be issued again. This cannot be undone.
        </Typography.Paragraph>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, whitespace: true, message: 'Enter a reason for revoking this certificate' }]}
          >
            <Input.TextArea aria-label="Reason" rows={3} maxLength={MAX_REASON} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
