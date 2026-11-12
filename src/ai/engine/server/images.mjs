import sharp from 'sharp';
import { ensure,DomainError } from '../src/errors.mjs';
export async function decodeImage(image,maxBytes=2097152) {
  ensure(image&&typeof image==='object'&&!Array.isArray(image)&&Object.keys(image).every(k=>['mime_type','data_base64'].includes(k)),'INVALID_IMAGE','Format gambar tidak valid.');
  ensure(['image/jpeg','image/png','image/webp'].includes(image.mime_type),'INVALID_IMAGE','Gunakan JPEG, PNG, atau WebP.');
  const b64=image.data_base64;
  ensure(typeof b64==='string'&&b64.length>0&&b64.length<=Math.ceil(maxBytes/3)*4&&b64.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(b64),'INVALID_IMAGE','Encoding atau ukuran gambar tidak valid.');
  const bytes=Buffer.from(b64,'base64');
  ensure(bytes.length>0&&bytes.length<=maxBytes&&bytes.toString('base64')===b64,'INVALID_IMAGE','Ukuran atau encoding gambar tidak valid.');
  try {
    const pipe=sharp(bytes,{limitInputPixels:12000000,failOn:'warning'}),meta=await pipe.metadata();
    const actual={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[meta.format];
    ensure(actual===image.mime_type&&meta.width>0&&meta.height>0&&(meta.pages??1)===1,'INVALID_IMAGE','Tipe/isi gambar tidak sesuai atau gambar animasi.');
    const normalized=await pipe.rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
    return {mimeType:'image/jpeg',data:normalized.toString('base64'),width:meta.width,height:meta.height};
  }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('INVALID_IMAGE','File tidak dapat dibaca sebagai gambar.',422);}
}
