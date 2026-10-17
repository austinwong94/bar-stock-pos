import { PageHeader } from './Page';
import { KitchenWorkflowNav } from './KitchenWorkflowNav';
import { WorkflowHelp } from './WorkflowHelp';
import { useLanguage } from '../lib/language';
import { useAccess } from '../lib/access';
import { KitchenWorkQueue } from './KitchenWorkQueue';

export function KitchenHelp() {
  return <WorkflowHelp area="kitchen" />;
}

export function KitchenHeader() {
  const { text } = useLanguage();
  const { profile } = useAccess();
  return <div className="kitchen-header"><PageHeader title={text('Kitchen', 'Dapur')}/><KitchenWorkflowNav/><KitchenWorkQueue key={profile?.id}/><div className="kitchen-help"><KitchenHelp/></div></div>;
}
