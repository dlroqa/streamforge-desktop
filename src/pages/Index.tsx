import { StudioProvider } from '@/contexts/StudioContext';
import { TeleprompterProvider } from '@/contexts/TeleprompterContext';
import { StudioLayout } from '@/components/studio/StudioLayout';

const Index = () => {
  return (
    <StudioProvider>
      <TeleprompterProvider>
        <StudioLayout />
      </TeleprompterProvider>
    </StudioProvider>
  );
};

export default Index;
