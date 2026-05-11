import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface LprResult {
  success: boolean;
  licensePlate: string;
  province: string;
  charPart: string;
  digitPart: string;
  raw?: any;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class LprService {

  // LPR API (AI for Thai)
  // Dev: ใช้ proxy ผ่าน /api/aiforthai เพื่อหลีกเลี่ยง CORS
  // Prod: เรียก API ตรง (ถ้า deploy เป็น native app หรือมี server proxy) หรือ Vercel rewrite
  private readonly API_URL = '/api/aiforthai/lpr-iapp';
  private readonly API_KEY = 'su2arg5kPh5jGEX1wSAUPB79vvdLuDdI';

  constructor(private http: HttpClient) {}

  /**
   * ถ่ายรูปจากกล้องและส่งไปยัง AI for Thai LPR API
   * @returns Promise<LprResult>
   */
  async captureAndRecognize(): Promise<LprResult> {
    try {
      const imageFile = await this.captureFromCamera();
      if (!imageFile) {
        return { success: false, licensePlate: '', province: '', charPart: '', digitPart: '', error: 'ไม่สามารถถ่ายรูปได้' };
      }

      return await this.recognizePlate(imageFile);
    } catch (error: any) {
      console.error('[LprService] Error:', error);
      return {
        success: false,
        licensePlate: '',
        province: '',
        charPart: '',
        digitPart: '',
        error: error.message || 'เกิดข้อผิดพลาดในการสแกนป้ายทะเบียน'
      };
    }
  }

  /**
   * ส่งไฟล์รูปภาพไปยัง AI for Thai LPR API (lpr-iapp)
   */
  async recognizePlate(imageFile: File): Promise<LprResult> {
    try {
      // แปลงไฟล์เป็น JPEG ก่อนส่ง (API รองรับเฉพาะ jpg/jpeg)
      const jpegFile = await this.ensureJpeg(imageFile);

      const formData = new FormData();
      formData.append('file', jpegFile);

      const headers = new HttpHeaders({
        'Apikey': this.API_KEY
      });

      const response: any = await firstValueFrom(
        this.http.post(this.API_URL, formData, { headers })
      );

      console.log('[LprService] LPR Response:', response);

      // Parse lpr-iapp response format
      if (response && response.message === 'success' && response.status === 200) {
        if (response.is_missing_plate === 'yes') {
          return {
            success: false,
            licensePlate: '',
            province: '',
            charPart: '',
            digitPart: '',
            raw: response,
            error: 'ไม่พบป้ายทะเบียนในรูปภาพ กรุณาลองใหม่'
          };
        }

        const lpNumber = response.lp_number || '';
        const provinceRaw = response.province || '';
        
        // แยกตัวอักษรและตัวเลข (เช่น "2ฒช6726" -> "2ฒช", "6726")
        let rChar = lpNumber;
        let rDigit = '';
        const match = lpNumber.match(/^(.+?)(\d+)$/);
        if (match) {
            rChar = match[1];
            rDigit = match[2];
        }

        // ดึงชื่อจังหวัดภาษาไทยออกจากวงเล็บ (เช่น "th-10:Bangkok (กรุงเทพมหานคร)" -> "กรุงเทพมหานคร")
        let rProvince = provinceRaw;
        const provinceMatch = provinceRaw.match(/\(([^)]+)\)/);
        if (provinceMatch) {
            rProvince = provinceMatch[1];
        }

        if (lpNumber && lpNumber !== ' ') {
          return {
            success: true,
            licensePlate: lpNumber,
            province: rProvince,
            charPart: rChar,
            digitPart: rDigit,
            raw: response
          };
        }

        // ไม่พบป้ายทะเบียน
        return {
          success: false,
          licensePlate: '',
          province: '',
          charPart: '',
          digitPart: '',
          raw: response,
          error: 'ไม่พบป้ายทะเบียนในรูปภาพ กรุณาลองใหม่'
        };
      }

      return {
        success: false,
        licensePlate: '',
        province: '',
        charPart: '',
        digitPart: '',
        error: response?.message || 'ไม่ได้รับข้อมูลจาก API'
      };
    } catch (error: any) {
      console.error('[LprService] API Error:', error);

      let errorMsg = 'เกิดข้อผิดพลาดในการเรียก API';

      if (error.status === 0) {
        errorMsg = 'ไม่สามารถเชื่อมต่อ API ได้ (อาจเป็นปัญหา CORS หรือเครือข่าย)';
      } else if (error.status === 401 || error.status === 403) {
        errorMsg = 'API Key ไม่ถูกต้องหรือหมดอายุ';
      } else if (error.status === 413) {
        errorMsg = 'ไฟล์รูปภาพใหญ่เกินไป กรุณาลองใหม่';
      } else if (error.status >= 500) {
        // API อาจ return 500 เมื่อรูปไม่ใช่ป้ายทะเบียน หรือ process ไม่ได้
        // ตรวจสอบ response body เพื่อแยกแยะ
        const errorBody = error.error;
        const bodyStr = typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody || '');
        const isNotPlate = bodyStr.includes('No license plate') ||
                           bodyStr.includes('cannot detect') ||
                           bodyStr.includes('no plate') ||
                           bodyStr.includes('error') ||
                           bodyStr.includes('index out of range') ||
                           bodyStr.includes('Internal');
        
        if (isNotPlate) {
          errorMsg = 'ไม่พบป้ายทะเบียนในรูปภาพ กรุณาถ่ายรูปป้ายทะเบียนให้ชัดเจนและลองใหม่';
        } else {
          errorMsg = 'เซิร์ฟเวอร์ AI for Thai มีปัญหาชั่วคราว กรุณาลองใหม่';
        }
      } else if (error.message) {
        errorMsg = error.message;
      }

      return {
        success: false,
        licensePlate: '',
        province: '',
        charPart: '',
        digitPart: '',
        error: errorMsg
      };
    }
  }

  /**
   * เปิดกล้องเพื่อถ่ายรูป หรือเลือกรูปจากแกลเลอรี
   */
  captureFromCamera(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/jpg,image/*'; // รองรับ jpeg เป็นหลัก
      input.capture = 'environment'; // ใช้กล้องหลัง

      input.onchange = (event: any) => {
        const file = event.target.files?.[0];
        if (file) {
          // ตรวจสอบขนาดไฟล์ (max 5MB)
          if (file.size > 5 * 1024 * 1024) {
            this.resizeImage(file, 1280).then(resizedFile => {
              resolve(resizedFile);
            }).catch(() => resolve(file));
          } else {
            resolve(file);
          }
        } else {
          resolve(null);
        }
      };

      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  /**
   * แปลงรูปภาพเป็น JPEG (API รองรับเฉพาะ jpg/jpeg)
   */
  private ensureJpeg(file: File): Promise<File> {
    // ถ้าเป็น JPEG อยู่แล้ว ไม่ต้องแปลง
    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
      return Promise.resolve(file);
    }

    // แปลงเป็น JPEG
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);

          canvas.toBlob((blob) => {
            if (blob) {
              const jpegName = file.name.replace(/\.[^.]+$/, '.jpg');
              resolve(new File([blob], jpegName, { type: 'image/jpeg' }));
            } else {
              // fallback: ส่งไฟล์เดิมไป
              resolve(file);
            }
          }, 'image/jpeg', 0.92);
        };
        img.onerror = () => resolve(file); // fallback
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file); // fallback
      reader.readAsDataURL(file);
    });
  }

  /**
   * Resize image ให้เล็กลงก่อนส่ง API
   */
  private resizeImage(file: File, maxWidth: number): Promise<File> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            if (blob) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
            } else {
              reject(new Error('Failed to resize'));
            }
          }, 'image/jpeg', 0.85);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
