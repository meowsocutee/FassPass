import { Component, Input, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { LprService, LprResult } from '../../services/lpr.service';

type ScannerState = 'choose' | 'preview' | 'scanning' | 'result' | 'error';

@Component({
    selector: 'app-lpr-scanner',
    templateUrl: './lpr-scanner.component.html',
    styleUrls: ['./lpr-scanner.component.scss'],
    standalone: true,
    imports: [CommonModule, IonicModule]
})
export class LprScannerComponent {
    @Input() bookingPlate: string = '';
    @Input() mode: 'checkin' | 'checkout' = 'checkin';

    @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
    @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;

    state: ScannerState = 'choose';
    imagePreviewUrl: string | null = null;
    selectedFile: File | null = null;
    scanResult: LprResult | null = null;
    errorMessage: string = '';
    isMatch: boolean = false;

    // Camera state
    isCameraOpen: boolean = false;
    private mediaStream: MediaStream | null = null;

    constructor(
        private modalCtrl: ModalController,
        private lprService: LprService
    ) {}

    dismiss(data?: any) {
        this.stopCamera();
        this.modalCtrl.dismiss(data);
    }

    // ============ Choose Method ============

    async onChooseUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';

        input.onchange = (event: any) => {
            const file = event.target.files?.[0];
            if (file) {
                this.selectedFile = file;
                this.previewImage(file);
            }
        };
        input.click();
    }

    async onChooseCamera() {
        try {
            this.isCameraOpen = true;
            this.state = 'preview';

            // Wait for view to render
            await new Promise(resolve => setTimeout(resolve, 100));

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            this.mediaStream = stream;

            if (this.videoElement?.nativeElement) {
                this.videoElement.nativeElement.srcObject = stream;
                await this.videoElement.nativeElement.play();
            }
        } catch (err: any) {
            console.error('[LprScanner] Camera error:', err);
            this.isCameraOpen = false;
            this.state = 'error';

            if (err.name === 'NotAllowedError') {
                this.errorMessage = 'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตการเข้าถึงกล้องในการตั้งค่าเบราว์เซอร์';
            } else if (err.name === 'NotFoundError') {
                this.errorMessage = 'ไม่พบกล้องในอุปกรณ์นี้';
            } else {
                this.errorMessage = 'ไม่สามารถเปิดกล้องได้: ' + (err.message || 'Unknown error');
            }
        }
    }

    capturePhoto() {
        if (!this.videoElement?.nativeElement || !this.canvasElement?.nativeElement) return;

        const video = this.videoElement.nativeElement;
        const canvas = this.canvasElement.nativeElement;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0);

        this.stopCamera();
        this.isCameraOpen = false;

        canvas.toBlob((blob) => {
            if (blob) {
                this.selectedFile = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
                this.imagePreviewUrl = canvas.toDataURL('image/jpeg', 0.92);
            }
        }, 'image/jpeg', 0.92);
    }

    private stopCamera() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
    }

    // ============ Preview ============

    private previewImage(file: File) {
        const reader = new FileReader();
        reader.onload = (e: any) => {
            this.imagePreviewUrl = e.target.result;
            this.state = 'preview';
            this.isCameraOpen = false;
        };
        reader.readAsDataURL(file);
    }

    onBackToChoose() {
        this.stopCamera();
        this.isCameraOpen = false;
        this.imagePreviewUrl = null;
        this.selectedFile = null;
        this.scanResult = null;
        this.errorMessage = '';
        this.state = 'choose';
    }

    // ============ Scanning ============

    async onStartScan() {
        if (!this.selectedFile) return;

        this.state = 'scanning';
        this.errorMessage = '';

        try {
            const result = await this.lprService.recognizePlate(this.selectedFile);
            this.scanResult = result;

            if (result.success) {
                // Check plate match
                const bookingPlateClean = this.bookingPlate.replace(/\s+/g, '');
                const scannedPlateClean = result.licensePlate.replace(/\s+/g, '');
                this.isMatch = scannedPlateClean === bookingPlateClean
                    || scannedPlateClean.includes(bookingPlateClean)
                    || bookingPlateClean.includes(scannedPlateClean);

                this.state = 'result';
            } else {
                this.state = 'error';
                // Differentiate between "not a plate" vs server error
                if (result.error?.includes('ไม่พบป้ายทะเบียน')) {
                    this.errorMessage = 'ไม่พบป้ายทะเบียนในรูปภาพ\nกรุณาถ่ายรูปป้ายทะเบียนให้ชัดเจนและลองใหม่อีกครั้ง';
                } else if (result.error?.includes('เซิร์ฟเวอร์') || result.error?.includes('API')) {
                    this.errorMessage = result.error;
                } else {
                    this.errorMessage = result.error || 'ไม่สามารถอ่านป้ายทะเบียนได้ กรุณาลองใหม่';
                }
            }
        } catch (err: any) {
            console.error('[LprScanner] Scan error:', err);
            this.state = 'error';
            this.errorMessage = 'เกิดข้อผิดพลาดในการสแกน กรุณาลองใหม่';
        }
    }

    // ============ Result ============

    onConfirm() {
        this.dismiss({
            action: this.mode === 'checkin' ? 'lpr_checkin' : 'lpr_checkout',
            result: this.scanResult
        });
    }

    onRetry() {
        this.scanResult = null;
        this.errorMessage = '';
        this.imagePreviewUrl = null;
        this.selectedFile = null;
        this.isCameraOpen = false;
        this.state = 'choose';
    }

    get plateDisplay(): string {
        if (!this.scanResult) return '';
        return this.scanResult.province
            ? `${this.scanResult.licensePlate} ${this.scanResult.province}`
            : this.scanResult.licensePlate;
    }

    get modeLabel(): string {
        return this.mode === 'checkin' ? 'เช็คอิน' : 'เช็คเอาท์';
    }
}
