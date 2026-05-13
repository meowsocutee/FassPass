import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';
import { LineService } from '../../services/line.service';
import liff from '@line/liff';

@Component({
  selector: 'app-auth-modal',
  templateUrl: './auth-modal.component.html',
  styleUrls: ['./auth-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class AuthModalComponent implements OnInit {
  constructor(
    private authService: AuthService,
    private lineService: LineService,
    private modalCtrl: ModalController,
    private loadingCtrl: LoadingController
  ) { }

  async ngOnInit() {
    if (this.lineService.isLoggedIn()) {
      console.log('🔄 Detected LINE session, starting sync flow...');
      await this.handleSyncFlow();
    }
  }

  async loginWithLine() {
    if (this.lineService.isLoggedIn()) {
      await this.handleSyncFlow();
    } else {
      this.lineService.login();
    }
  }

  private async handleSyncFlow() {
    const loading = await this.loadingCtrl.create({ message: 'กำลังซิงค์ข้อมูล...' });
    await loading.present();

    try {
      const idToken = liff.getIDToken();
      if (!idToken) throw new Error("ID Token not found");

      const user = await this.authService.signInWithLineToken(idToken);

      if (user) {
        console.log('Auth Success:', user);
        this.modalCtrl.dismiss({ isLoggedIn: true });
      }
    } catch (err: any) {
      console.error('❌ Sync Error:', err);
      // We will show an alert only on real failure, not debug
      alert('ซิงค์ข้อมูลไม่สำเร็จ: ' + err.message);
      this.lineService.logout();
    } finally {
      await loading.dismiss();
    }
  }

  
  continueAsGuest() {
    this.modalCtrl.dismiss({ role: 'guest' });
  }
}