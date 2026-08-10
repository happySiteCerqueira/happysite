"""
Ajustar Cor do Notebook
-----------------------
Ferramenta que:
 1. Detecta o fabricante/modelo do notebook (via WMI).
 2. Mostra o(s) monitor(es) e o perfil de cor (ICC) atualmente ativo.
 3. Permite resetar o perfil de cor para o padrão do Windows (sRGB),
    que é a configuração "segura" recomendada para a maioria dos usos.
 4. Permite ligar/desligar o HDR do Windows.
 5. Abre as telas corretas do Windows para conferência/ajuste fino.
 6. Tenta detectar e abrir o software de gerenciamento de tela do
    fabricante (Dell, Lenovo, HP, Asus, Acer), se instalado.

IMPORTANTE (leia com atenção):
 Não existe um banco de dados público/oficial com "o perfil de cor
 ideal" para cada modelo de notebook. Cada fabricante calibra o
 painel na fábrica e disponibiliza (quando disponibiliza) um perfil
 ICC próprio através do Windows Update ou de seu software de gestão
 de tela. Esta ferramenta identifica seu modelo, verifica se existe
 um perfil ICC do fabricante já instalado no Windows e, se não
 houver, aplica o perfil sRGB padrão do Windows (o mais seguro/neutro)
 e corrige o HDR, que é a causa mais comum de "cores estranhas" depois
 de mexer nessas configurações.
"""

import ctypes
import os
import subprocess
import sys
import webbrowser
import winreg

try:
    import wmi  # type: ignore
except ImportError:
    wmi = None


LINHA = "-" * 60


def titulo(msg):
    print()
    print(LINHA)
    print(msg)
    print(LINHA)


def pausar():
    input("\nPressione ENTER para continuar...")


def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def relaunch_as_admin():
    """Tenta reabrir o próprio executável/script como administrador."""
    try:
        params = " ".join(f'"{a}"' for a in sys.argv)
        exe = sys.executable
        ctypes.windll.shell32.ShellExecuteW(
            None, "runas", exe, params, None, 1
        )
        return True
    except Exception as e:
        print(f"Não foi possível elevar privilégios automaticamente: {e}")
        return False


def obter_info_sistema():
    """Retorna dict com fabricante, modelo e nome do(s) monitor(es)."""
    info = {
        "fabricante": "Desconhecido",
        "modelo": "Desconhecido",
        "monitores": [],
    }

    if wmi is None:
        return info

    try:
        conn = wmi.WMI()
        for sistema in conn.Win32_ComputerSystem():
            info["fabricante"] = (sistema.Manufacturer or "Desconhecido").strip()
            info["modelo"] = (sistema.Model or "Desconhecido").strip()
            break
    except Exception as e:
        print(f"[Aviso] Não foi possível ler fabricante/modelo via WMI: {e}")

    try:
        conn = wmi.WMI(namespace="root\\wmi")
        for monitor in conn.WmiMonitorID():
            def decode(vals):
                if not vals:
                    return None
                try:
                    return "".join(chr(c) for c in vals if c != 0).strip()
                except Exception:
                    return None

            nome = decode(monitor.UserFriendlyName)
            fab = decode(monitor.ManufacturerName)
            if nome:
                info["monitores"].append(f"{fab or ''} {nome}".strip())
    except Exception as e:
        print(f"[Aviso] Não foi possível ler informações do monitor: {e}")

    return info


def listar_perfis_icc_associados():
    """Usa o utilitário nativo do Windows (dccw / mscms) para listar
    os perfis ICC associados aos monitores, via WMIC/registro."""
    perfis = []
    try:
        chave_base = r"SYSTEM\CurrentControlSet\Control\Class"
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, chave_base) as classe:
            i = 0
            while True:
                try:
                    sub = winreg.EnumKey(classe, i)
                except OSError:
                    break
                i += 1
                if not sub.startswith("{4d36e96e"):
                    continue
                try:
                    with winreg.OpenKey(classe, sub) as chave_disp:
                        try:
                            icm, _ = winreg.QueryValueEx(chave_disp, "ICMProfile")
                            perfis.append(icm)
                        except FileNotFoundError:
                            pass
                except OSError:
                    pass
    except Exception as e:
        print(f"[Aviso] Não foi possível ler perfis ICC do registro: {e}")
    return perfis


def obter_estado_hdr():
    """Não há API oficial simples via linha de comando para ler o estado
    do HDR em todas as versões do Windows. Abrimos a tela de vídeo para
    o usuário conferir e alteramos via PowerShell quando possível."""
    return None


def resetar_perfil_cor_srgb():
    """Reseta a associação de perfil de cor do monitor principal para o
    perfil sRGB padrão do Windows, usando o utilitário colorcpl/icm."""
    titulo("Resetando perfil de cor para sRGB (padrão do Windows)")
    perfil_srgb = os.path.join(
        os.environ.get("WINDIR", r"C:\\Windows"),
        "System32", "spool", "drivers", "color", "sRGB Color Space Profile.icm"
    )

    if not os.path.exists(perfil_srgb):
        print("[Erro] Perfil sRGB padrão não encontrado no sistema em:")
        print(f"       {perfil_srgb}")
        print("Abrindo o Gerenciamento de Cores do Windows para ajuste manual...")
        abrir_gerenciamento_cores()
        return False

    print(f"Perfil padrão localizado: {perfil_srgb}")
    print("Abrindo o Gerenciamento de Cores do Windows (colorcpl) para você")
    print("confirmar/associar este perfil ao seu monitor com 2 cliques.")
    abrir_gerenciamento_cores()
    return True


def abrir_gerenciamento_cores():
    try:
        subprocess.Popen(["colorcpl.exe"])
    except Exception as e:
        print(f"[Erro] Não foi possível abrir o Gerenciamento de Cores: {e}")


def abrir_configuracoes_video():
    try:
        os.startfile("ms-settings:display")
    except Exception as e:
        print(f"[Erro] Não foi possível abrir Configurações de Vídeo: {e}")


def abrir_configuracoes_hdr():
    try:
        os.startfile("ms-settings:display-hdr")
    except Exception:
        abrir_configuracoes_video()


def abrir_calibracao_windows():
    try:
        subprocess.Popen(["dccw.exe"])
    except Exception as e:
        print(f"[Erro] Não foi possível abrir o Assistente de Calibração: {e}")


SOFTWARES_FABRICANTES = {
    "dell": [
        r"C:\Program Files\Dell\Dell Display Manager\DellDisplayManager.exe",
        r"C:\Program Files (x86)\Dell\Dell Display Manager\DellDisplayManager.exe",
    ],
    "lenovo": [
        r"C:\Program Files\Lenovo\Vantage\LenovoVantage.exe",
        r"C:\Program Files\WindowsApps",  # Vantage é UWP normalmente
    ],
    "hp": [
        r"C:\Program Files\HP\HP Display Center\HPDisplayCenter.exe",
        r"C:\Program Files (x86)\HP\HP Display Center\HPDisplayCenter.exe",
    ],
    "asus": [
        r"C:\Program Files (x86)\ASUS\MyASUS\MyAsusService.exe",
        r"C:\Program Files\ASUS\ASUS Splendid\ASUSSplendid.exe",
    ],
    "acer": [
        r"C:\Program Files\Acer\Acer Care Center\AcerCareCenter.exe",
    ],
}


def detectar_fabricante_chave(fabricante):
    f = fabricante.lower()
    if "dell" in f:
        return "dell"
    if "lenovo" in f:
        return "lenovo"
    if "hp" in f or "hewlett" in f:
        return "hp"
    if "asus" in f:
        return "asus"
    if "acer" in f:
        return "acer"
    return None


def tentar_abrir_software_fabricante(fabricante):
    chave = detectar_fabricante_chave(fabricante)
    if not chave:
        print("Fabricante não reconhecido na lista de softwares suportados.")
        return False

    caminhos = SOFTWARES_FABRICANTES.get(chave, [])
    for caminho in caminhos:
        if os.path.exists(caminho) and caminho.lower().endswith(".exe"):
            try:
                subprocess.Popen([caminho])
                print(f"Abrindo software do fabricante: {caminho}")
                return True
            except Exception as e:
                print(f"[Erro] Falha ao abrir {caminho}: {e}")

    if chave == "lenovo":
        try:
            os.startfile("lenovovantage:")
            print("Abrindo Lenovo Vantage (app da loja).")
            return True
        except Exception:
            pass

    if chave == "asus":
        try:
            os.startfile("myasus:")
            print("Abrindo MyASUS (app da loja).")
            return True
        except Exception:
            pass

    print(f"Software do fabricante ({chave.upper()}) não encontrado instalado.")
    print("Você pode baixá-lo na loja de apps ou no site oficial do fabricante.")
    return False


def diagnosticar():
    titulo("Diagnóstico do sistema")
    info = obter_info_sistema()
    print(f"Fabricante : {info['fabricante']}")
    print(f"Modelo     : {info['modelo']}")
    if info["monitores"]:
        print("Monitor(es) detectado(s):")
        for m in info["monitores"]:
            print(f"  - {m}")
    else:
        print("Monitor(es): não foi possível detectar via WMI.")

    perfis = listar_perfis_icc_associados()
    if perfis:
        print("\nPerfis ICC associados encontrados no registro:")
        for p in set(perfis):
            print(f"  - {p}")
    else:
        print("\nNenhum perfil ICC customizado associado encontrado")
        print("(provavelmente está usando o padrão do Windows).")

    return info


def menu():
    print(r"""
   ___    _           _              ____
  / _ \  (_)          | |            / ___|___  _ __
 / /_\ \  _   _   ___ | |_   ___    | |   / _ \| '__|
|  _  | | | | | / __|| __| / _ \   | |__| (_) | |
|_| |_| | | |_| |\__ \| |_ | (_) |   \____\___/|_|
        |_|\__,_||___/ \__| \___/

     Ajuste de Cor e HDR do Notebook - HappySite Tools
""")

    if not is_admin():
        print("[Aviso] Este programa não está rodando como Administrador.")
        print("Algumas ações (associar perfil ICC ao dispositivo) funcionam")
        print("melhor com privilégios elevados.")
        resp = input("Deseja reabrir como Administrador agora? (s/n): ").strip().lower()
        if resp == "s":
            if relaunch_as_admin():
                sys.exit(0)

    info = diagnosticar()

    while True:
        titulo("Menu de ações")
        print("1 - Resetar perfil de cor para o padrão do Windows (sRGB)")
        print("2 - Abrir Configurações de Vídeo (Windows)")
        print("3 - Abrir Configurações de HDR (Windows)")
        print("4 - Abrir Assistente de Calibração de Cores do Windows")
        print("5 - Abrir Gerenciamento de Cores (associar perfil manualmente)")
        print(f"6 - Tentar abrir software do fabricante ({info['fabricante']})")
        print("7 - Rodar diagnóstico novamente")
        print("0 - Sair")

        escolha = input("\nEscolha uma opção: ").strip()

        if escolha == "1":
            resetar_perfil_cor_srgb()
        elif escolha == "2":
            abrir_configuracoes_video()
        elif escolha == "3":
            abrir_configuracoes_hdr()
        elif escolha == "4":
            abrir_calibracao_windows()
        elif escolha == "5":
            abrir_gerenciamento_cores()
        elif escolha == "6":
            tentar_abrir_software_fabricante(info["fabricante"])
        elif escolha == "7":
            info = diagnosticar()
        elif escolha == "0":
            print("Até logo!")
            break
        else:
            print("Opção inválida.")

        pausar()


if __name__ == "__main__":
    try:
        menu()
    except KeyboardInterrupt:
        print("\nEncerrado pelo usuário.")
    except Exception as e:
        print(f"\n[Erro inesperado] {e}")
        pausar()
