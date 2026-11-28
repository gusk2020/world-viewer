import json,sys,base64,urllib.request,io
from PIL import Image
src,out,strength,prompt=sys.argv[1],sys.argv[2],float(sys.argv[3]),sys.argv[4]
im=Image.open(src).convert('RGB')
buf=io.BytesIO(); im.save(buf,'JPEG',quality=92)
uri='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
body={"image_url":uri,"prompt":prompt,"strength":strength,"num_inference_steps":32,"guidance_scale":3.5,"num_images":1,"sync_mode":True,"enable_safety_checker":True}
req=urllib.request.Request("https://fal.run/fal-ai/flux/dev/image-to-image",data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
try:
    d=json.load(urllib.request.urlopen(req,timeout=300))
except urllib.error.HTTPError as e:
    print("HTTP",e.code,e.read()[:500]); sys.exit(1)
u=d["images"][0]["url"]
if u.startswith("data:"):
    data=base64.b64decode(u.split(",",1)[1])
else:
    data=urllib.request.urlopen(u).read()
open(out,"wb").write(data)
json.dump({"model":"fal-ai/flux/dev/image-to-image","source":src,"strength":strength,"prompt":prompt,"seed":d.get("seed")},open(out+".meta.json","w"),ensure_ascii=False)
print(out,"ok seed",d.get("seed"))
