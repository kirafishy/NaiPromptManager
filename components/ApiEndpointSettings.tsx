import React, { useEffect, useState } from 'react';
import {
  OFFICIAL_NAI_ENDPOINT,
  getCustomEndpoint,
  getEffectiveApiEndpoint,
  isCustomEndpointEnabled,
  resetCustomEndpoint,
  setCustomEndpointConfig,
  setCustomEndpointEnabled,
  subscribeApiEndpoint,
  validateEndpoint,
} from '../services/apiEndpointStore';
import { refreshNaiAccount } from '../services/naiAccountStore';
import { Button, Field, Input, Panel, Switch } from './ui';

export function ApiEndpointSettings() {
  const [enabled, setEnabled] = useState(() => isCustomEndpointEnabled());
  const [endpointDraft, setEndpointDraft] = useState(() => getCustomEndpoint());
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [effectiveUrl, setEffectiveUrl] = useState(() => getEffectiveApiEndpoint());

  useEffect(() => {
    const sync = () => {
      setEnabled(isCustomEndpointEnabled());
      setEndpointDraft(getCustomEndpoint());
      setEffectiveUrl(getEffectiveApiEndpoint());
    };
    return subscribeApiEndpoint(sync);
  }, []);

  const handleToggle = (checked: boolean) => {
    setError('');
    setStatus('');
    if (!checked) {
      setCustomEndpointEnabled(false);
      setEnabled(false);
      setEffectiveUrl(OFFICIAL_NAI_ENDPOINT);
      setStatus('已切换回官方端点');
      void refreshNaiAccount();
      return;
    }

    setEnabled(true);
    const trimmed = endpointDraft.trim();
    if (trimmed) {
      const check = validateEndpoint(trimmed);
      if (check.valid) {
        setCustomEndpointConfig({ enabled: true, endpoint: trimmed });
        setEffectiveUrl(getEffectiveApiEndpoint());
        setStatus('已启用自定义端点');
        void refreshNaiAccount();
      } else {
        setError(check.error || '请输入有效的端点 URL');
      }
    } else {
      setStatus('请配置自定义 API 端点地址');
    }
  };

  const handleSave = () => {
    setError('');
    setStatus('');
    const trimmed = endpointDraft.trim();
    if (!trimmed) {
      setError('请输入自定义端点地址');
      return;
    }

    const check = validateEndpoint(trimmed);
    if (!check.valid) {
      setError(check.error || '请输入有效的端点 URL');
      return;
    }

    setCustomEndpointConfig({ enabled: true, endpoint: trimmed });
    setEnabled(true);
    setEffectiveUrl(getEffectiveApiEndpoint());
    setStatus('已保存自定义端点');
    void refreshNaiAccount();
  };

  const handleReset = () => {
    resetCustomEndpoint();
    setEnabled(false);
    setEndpointDraft('');
    setError('');
    setStatus('已恢复官方默认端点');
    setEffectiveUrl(OFFICIAL_NAI_ENDPOINT);
    void refreshNaiAccount();
  };

  return (
    <Panel title="API 端点" className="settings-api-endpoint">
      <div className="pref-row">
        <div>自定义端点</div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          aria-label="自定义端点"
        />
      </div>

      {!enabled ? (
        <p className="hint">
          默认使用官方 API 端点（{OFFICIAL_NAI_ENDPOINT}）
        </p>
      ) : (
        <div className="endpoint-config mt-2">
          <Field
            label="自定义 API 地址"
            error={error || undefined}
            hint={!error ? (status || '支持配置第三方反代或兼容服务端点 Base URL') : undefined}
          >
            <Input
              type="url"
              value={endpointDraft}
              placeholder={OFFICIAL_NAI_ENDPOINT}
              onChange={(e) => {
                setEndpointDraft(e.target.value);
                setError('');
                setStatus('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSave();
                }
              }}
              aria-label="自定义 API 地址"
            />
          </Field>
          <div className="flex gap-2 mt-3">
            <Button variant="secondary" size="sm" onClick={handleSave}>
              保存端点
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              恢复默认
            </Button>
          </div>
          <div className="endpoint-preview text-xs text-[var(--muted)] mt-2">
            当前生效端点：<span className="font-mono text-[var(--ink)]">{effectiveUrl}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
