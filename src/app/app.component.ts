import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { AuthService } from './services/auth.service';
import { LineService } from './services/line.service';
import { AuthModalComponent } from './modal/auth-modal/auth-modal.component';
import { ReservationService } from './services/reservation.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(
    private authService: AuthService,
    private lineService: LineService,
    private modalCtrl: ModalController,
    private reservationService: ReservationService
  ) { }

  async ngOnInit() {
    await this.checkAuthStatus();
  }

  private async checkAuthStatus() {
    if (this.isGuestChoice) return;

    let user = await this.authService.getCurrentUser();
    if (!user) user = await this.authService.signInAnonymously();

    if (user) {
      this.reservationService.setCurrentProfileId(user.id);
      const profile = await this.authService.getProfile(user.id);
      if (!profile || !profile.line_id) {
        const modal = await this.modalCtrl.create({
          component: AuthModalComponent,
          backdropDismiss: false
        });
        await modal.present();

        const { data } = await modal.onDidDismiss();
        if (data?.role === 'guest') {
          this.isGuestChoice = true;
        } else if (data?.isLoggedIn) {
          const loggedInUser = await this.authService.getCurrentUser();
          if (loggedInUser) {
            this.reservationService.setCurrentProfileId(loggedInUser.id);
          }
        }
      }
    }
  }

  async showAuthLanding() {
    const modal = await this.modalCtrl.create({
      component: AuthModalComponent,
      backdropDismiss: false,
      cssClass: 'auth-full-screen'
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data?.isLoggedIn) {
      console.log('User logged in successfully');
      const loggedInUser = await this.authService.getCurrentUser();
      if (loggedInUser) {
        this.reservationService.setCurrentProfileId(loggedInUser.id);
      }
    }
  }

  private isGuestChoice = false;


}