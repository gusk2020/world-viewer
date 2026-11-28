import json,sys,base64,urllib.request,io
from PIL import Image
endpoint,src,out,prompt=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
im=Image.open(src).convert('RGB'); buf=io.BytesIO(); im.save(buf,'JPEG',quality=92)
uri='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
body={"control_image_url":uri,"prompt":prompt,"num_images":1,"sync_mode":True,"output_format":"png","image_size":{"width":1920,"height":1080},"safety_tolerance":"2"}
req=urllib.request.Request("https://fal.run/"+endpoint,data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
try: d=json.load(urllib.request.urlopen(req,timeout=300))
except urllib.error.HTTPError as e: print("HTTP",e.code,e.read()[:600]); sys.exit(1)
u=d["images"][0]["url"]
data=base64.b64decode(u.split(",",1)[1]) if u.startswith("data:") else urllib.request.urlopen(u).read()
open(out,"wb").write(data)
json.dump({"model":endpoint,"source":src,"prompt":prompt,"seed":d.get("seed")},open(out+".meta.json","w"),ensure_ascii=False)
print(out,"ok",d.get("seed"),Image.open(out).size)
