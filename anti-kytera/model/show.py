import json, sys
for r in sys.argv[1:]:
    s = json.load(open(f"runs/{r}/summary.json")); i = s["ice"]
    print(f"{r}: t={i['t_end_kyr']:.0f} kyr converged={i['converged']} V={i['volume_Mkm3']:.2f} (obs {i['volume_obs_Mkm3']:.2f}) Mkm3")
    for k in i["regions_model"]:
        m, o = i["regions_model"][k], i["regions_obs"][k]
        print(f"  {k:28s} model V {m['volume_Mkm3']:6.2f} A {m['area_Mkm2']:6.2f} | obs V {o['volume_Mkm3']:6.2f} A {o['area_Mkm2']:6.2f}")
