import React, { useEffect, useState } from 'react';
import { subscribeApiEndpoint } from '../services/apiEndpointStore';
import { hasApiKey, subscribeApiKey } from '../services/apiKeyStore';
import { getNaiSubscription, refreshNaiAccount, subscribeNaiAccount } from '../services/naiAccountStore';

export const AnlasChip: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [anlas, setAnlas] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => {
      const sub = getNaiSubscription();
      setAnlas(sub ? sub.anlas : null);
    };
    const unsubAccount = subscribeNaiAccount(sync);
    const unsubKey = subscribeApiKey(() => { void refreshNaiAccount(); });
    const unsubEndpoint = subscribeApiEndpoint(() => { void refreshNaiAccount(); });
    sync();
    if (hasApiKey()) void refreshNaiAccount();
    return () => {
      unsubAccount();
      unsubKey();
      unsubEndpoint();
    };
  }, []);

  if (anlas === null) return null;

  return (
    <div className={compact ? 'anlas-chip compact' : 'anlas-chip'} title={`Anlas ${anlas.toLocaleString()}`}>
      <svg className="anlas-icon" width="10" height="9" viewBox="0 0 10 9" aria-hidden="true">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          fill="currentColor"
          d="M4.48874 0H5.51107L7.14867 1.60183L5.45731 8.99994H4.54284L2.85142 1.60156L4.48874 0ZM7.47144 9L10 5.04294V4.39087L8.65736 3.07756L8.24906 3.18423L6.91946 9H7.47144ZM3.08069 9L1.7543 3.19828L1.33187 3.08792L0 4.39069V5.04271L2.52871 9H3.08069Z"
        />
      </svg>
      <span>{anlas.toLocaleString()}</span>
    </div>
  );
};
