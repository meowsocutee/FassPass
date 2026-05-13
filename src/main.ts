import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import liff from '@line/liff';

const bootstrapApp = () => {
  platformBrowserDynamic().bootstrapModule(AppModule)
    .catch(err => console.log(err));
};

if (environment.liffId) {
  liff.init({ liffId: environment.liffId })
    .then(() => {
      console.log('✅ LIFF Initialized Before Angular');
      bootstrapApp();
    })
    .catch((err) => {
      console.error('❌ LIFF Init Error in main.ts:', err);
      // Even if LIFF fails, we should still load the app so it's not a blank screen
      bootstrapApp();
    });
} else {
  console.warn('⚠️ No liffId found in environment, skipping LIFF init');
  bootstrapApp();
}
